// Self-contained Vercel serverless function. No imports from other /api files,
// so Vercel never tries to treat a helper as its own endpoint.

async function parseExpenseText({ text, people = [], months = [] }, env = process.env) {
  if (!env.OPENAI_API_KEY) {
    return { status: 503, body: { error: "OPENAI_API_KEY is not configured" } };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Parse Pakistani personal finance notes into JSON only. Currency is PKR. Return {items:[...],clarifications:[...]}. Item fields: kind expense|income|loan_sent|loan_received, title, amount number, category, person nullable, targetMonthName nullable, confidence 0-1. If the user mentions a month like March 2026, set targetMonthName exactly like 'March 2026'. If no month is mentioned, use null. If a person/name/relation plus amount is ambiguous, put it in clarifications with title, amount, person, targetMonthName, reason and do not create an item."
        },
        {
          role: "user",
          content: JSON.stringify({ text, knownPeople: people, existingMonths: months })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "expense_parse",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    kind: { type: "string", enum: ["expense", "income", "loan_sent", "loan_received"] },
                    title: { type: "string" },
                    amount: { type: "number" },
                    category: { type: "string" },
                    person: { type: ["string", "null"] },
                    targetMonthName: { type: ["string", "null"] },
                    confidence: { type: "number" }
                  },
                  required: ["kind", "title", "amount", "category", "person", "targetMonthName", "confidence"]
                }
              },
              clarifications: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    amount: { type: "number" },
                    person: { type: ["string", "null"] },
                    targetMonthName: { type: ["string", "null"] },
                    reason: { type: "string" }
                  },
                  required: ["title", "amount", "person", "targetMonthName", "reason"]
                }
              }
            },
            required: ["items", "clarifications"]
          },
          strict: true
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    return { status: response.status, body: { error: data.error?.message || "OpenAI request failed" } };
  }

  const textOutput = data.output_text || data.output?.[0]?.content?.[0]?.text || "{}";
  return { status: 200, body: JSON.parse(textOutput) };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const result = await parseExpenseText(req.body || {});
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
