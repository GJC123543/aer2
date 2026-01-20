import type { Context, Config } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const apiKey = Netlify.env.get("ALPHA_VANTAGE_API_KEY") || "demo";
  
  try {
    // Fetch current quote
    const quoteResponse = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AER&apikey=${apiKey}`
    );
    const quoteData = await quoteResponse.json();
    
    // Fetch daily time series
    const timeSeriesResponse = await fetch(
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=AER&outputsize=compact&apikey=${apiKey}`
    );
    const timeSeriesData = await timeSeriesResponse.json();
    
    // Parse the quote data
    const quote = quoteData["Global Quote"];
    const currentData = quote ? {
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
    } : null;
    
    // Parse time series data
    const timeSeries = timeSeriesData["Time Series (Daily)"];
    const historicalData = timeSeries ? Object.entries(timeSeries)
      .slice(0, 100)
      .map(([date, values]: [string, any]) => ({
        date,
        open: parseFloat(values["1. open"]),
        high: parseFloat(values["2. high"]),
        low: parseFloat(values["3. low"]),
        close: parseFloat(values["4. close"]),
        volume: parseInt(values["5. volume"])
      }))
      .reverse() : [];
    
    // Calculate technical indicators
    const closes = historicalData.map(d => d.close);
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
      const returns = [];
      for (let i = closes.length - 20; i < closes.length; i++) {
        returns.push((closes[i] - closes[i-1]) / closes[i-1] * 100);
      }
      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
      volatility = Math.sqrt(variance);
    }
    
    // 52-week high/low approximation from available data
    const allHighs = historicalData.map(d => d.high);
    const allLows = historicalData.map(d => d.low);
    const high52w = Math.max(...allHighs);
    const low52w = Math.min(...allLows);
    
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
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config: Config = {
  path: "/api/aer-data"
};
