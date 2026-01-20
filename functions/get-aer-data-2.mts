import type { Context, Config } from "@netlify/functions";

// Helper to add delay between API calls
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default async (req: Request, context: Context) => {
  const apiKey = Netlify.env.get("ALPHA_VANTAGE_API_KEY") || "demo";
  
  try {
    // Fetch current quote
    const quoteUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AER&apikey=${apiKey}`;
    console.log("Fetching quote...");
    
    const quoteResponse = await fetch(quoteUrl);
    const quoteData = await quoteResponse.json();
    
    console.log("Quote response keys:", Object.keys(quoteData));
    
    // Check for API errors/rate limits
    if (quoteData["Note"] || quoteData["Information"]) {
      console.log("API limit hit on quote:", quoteData["Note"] || quoteData["Information"]);
      return new Response(JSON.stringify({
        success: false,
        error: quoteData["Note"] || quoteData["Information"],
        hint: "Alpha Vantage free tier allows 25 requests/day and 5/minute. Please wait and try again."
      }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Parse the quote data
    const quote = quoteData["Global Quote"];
    if (!quote || Object.keys(quote).length === 0) {
      console.log("No quote data, full response:", JSON.stringify(quoteData));
      return new Response(JSON.stringify({
        success: false,
        error: "No quote data returned from API",
        debug: quoteData
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    const currentData = {
      symbol: quote["01. symbol"],
      open: parseFloat(quote["02. open"]),
      high: parseFloat(quote["03. high"]),
      low: parseFloat(quote["04. low"]),
      price: parseFloat(quote["05. price"]),
      volume: parseInt(quote["06. volume"]),
      latestDay: quote["07. latest trading day"],
      previousClose: parseFloat(quote["08. previous close"]),
      change: parseFloat(quote["09. change"]),
      changePercent: quote["10. change percent"]
    };
    
    // Wait 1.5 seconds before second API call to avoid rate limiting
    await delay(1500);
    
    // Fetch daily time series
    const timeSeriesUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=AER&outputsize=compact&apikey=${apiKey}`;
    console.log("Fetching time series...");
    
    const timeSeriesResponse = await fetch(timeSeriesUrl);
    const timeSeriesData = await timeSeriesResponse.json();
    
    console.log("Time series response keys:", Object.keys(timeSeriesData));
    
    // Check for API errors on time series
    if (timeSeriesData["Note"] || timeSeriesData["Information"]) {
      console.log("API limit hit on time series:", timeSeriesData["Note"] || timeSeriesData["Information"]);
      // Return partial data - quote works but no historical
      return new Response(JSON.stringify({
        success: true,
        current: currentData,
        historical: [],
        indicators: {
          sma10: null,
          sma20: null,
          sma50: null,
          volatility: null,
          high52w: currentData.high,
          low52w: currentData.low
        },
        lastUpdated: new Date().toISOString(),
        warning: "Historical data unavailable due to API rate limits"
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Parse time series data
    const timeSeries = timeSeriesData["Time Series (Daily)"];
    console.log("Time series entries:", timeSeries ? Object.keys(timeSeries).length : 0);
    
    let historicalData: any[] = [];
    
    if (timeSeries && typeof timeSeries === 'object') {
      historicalData = Object.entries(timeSeries)
        .slice(0, 100)
        .map(([date, values]: [string, any]) => ({
          date,
          open: parseFloat(values["1. open"]),
          high: parseFloat(values["2. high"]),
          low: parseFloat(values["3. low"]),
          close: parseFloat(values["4. close"]),
          volume: parseInt(values["5. volume"])
        }))
        .reverse();
      
      console.log("Parsed historical entries:", historicalData.length);
    }
    
    // Calculate technical indicators
    const closes = historicalData.map(d => d.close).filter(c => !isNaN(c));
    console.log("Valid closes for indicators:", closes.length);
    
    const sma10 = closes.length >= 10 
      ? closes.slice(-10).reduce((a, b) => a + b, 0) / 10 
      : null;
    const sma20 = closes.length >= 20 
      ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 
      : null;
    const sma50 = closes.length >= 50 
      ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 
      : null;
    
    // Calculate volatility (20-day standard deviation of daily returns)
    let volatility = null;
    if (closes.length >= 21) {
      const returns: number[] = [];
      for (let i = closes.length - 20; i < closes.length; i++) {
        if (closes[i-1] !== 0) {
          returns.push((closes[i] - closes[i-1]) / closes[i-1] * 100);
        }
      }
      if (returns.length > 0) {
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
        volatility = Math.sqrt(variance);
      }
    }
    
    // High/low from available data
    const allHighs = historicalData.map(d => d.high).filter(h => !isNaN(h));
    const allLows = historicalData.map(d => d.low).filter(l => !isNaN(l));
    const high52w = allHighs.length > 0 ? Math.max(...allHighs) : currentData.high;
    const low52w = allLows.length > 0 ? Math.min(...allLows) : currentData.low;
    
    console.log("Indicators calculated:", { sma10, sma20, sma50, volatility, high52w, low52w });
    
    return new Response(JSON.stringify({
      success: true,
      current: currentData,
      historical: historicalData,
      indicators: {
        sma10,
        sma20,
        sma50,
        volatility,
        high52w,
        low52w
      },
      lastUpdated: new Date().toISOString()
    }), {
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (error) {
    console.error("Function error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config: Config = {
  path: "/api/aer-data"
};
