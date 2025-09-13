import OpenAI from "openai";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR;

if (!API_KEY) {
  console.error('❌ OPENAI_API_KEY environment variable is required but not found!');
  console.error('   Please set OPENAI_API_KEY in Replit secrets to enable AI features.');
  console.error('   The application will continue but AI features will be disabled.');
}

const openai = new OpenAI({ 
  apiKey: API_KEY || "invalid_key"
});

export async function generateChatGPTResponse(message: string, context?: string): Promise<string> {
  if (!API_KEY || API_KEY === "invalid_key") {
    return "AI features are currently disabled. Please contact the administrator to configure OpenAI API key.";
  }

  try {
    const systemPrompt = `You are a helpful WhatsApp bot assistant. Respond naturally and helpfully to user messages. ${context ? `Additional context: ${context}` : ''}`;
    
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    return response.choices[0].message.content || "I couldn't generate a response at the moment.";
  } catch (error) {
    console.error("OpenAI API error:", error);
    return "I'm currently unable to process your request. Please try again later.";
  }
}

export async function analyzeMessage(message: string): Promise<{
  intent: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
}> {
  if (!API_KEY || API_KEY === "invalid_key") {
    return {
      intent: 'unknown',
      sentiment: 'neutral',
      confidence: 0,
    };
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: "Analyze the intent and sentiment of the message. Respond with JSON in this format: { 'intent': string, 'sentiment': 'positive'|'negative'|'neutral', 'confidence': number }"
        },
        {
          role: "user",
          content: message
        }
      ],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    
    return {
      intent: result.intent || 'unknown',
      sentiment: result.sentiment || 'neutral',
      confidence: Math.max(0, Math.min(1, result.confidence || 0.5)),
    };
  } catch (error) {
    console.error("Message analysis error:", error);
    return {
      intent: 'unknown',
      sentiment: 'neutral',
      confidence: 0,
    };
  }
}
