export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return corsResponse(null, 204);
    }
    if (request.method !== "POST") {
      return corsResponse({ error: "Method not allowed" }, 405);
    }

    try {
      const { image } = await request.json();
      if (!image || typeof image !== "string") {
        return corsResponse({ error: "Missing image" }, 400);
      }

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-5.4-mini",
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text:
                    "Extract business card information from this image. Return only JSON matching the schema. " +
                    "If a value is unknown, use an empty string. Preserve Japanese text exactly.",
                },
                { type: "input_image", image_url: image },
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "business_card",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  company: { type: "string" },
                  title: { type: "string" },
                  email: { type: "string" },
                  phone: { type: "string" },
                  website: { type: "string" },
                  address: { type: "string" },
                  notes: { type: "string" },
                  rawText: { type: "string" },
                },
                required: ["name", "company", "title", "email", "phone", "website", "address", "notes", "rawText"],
              },
            },
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return corsResponse({ error: "OpenAI request failed", detail: data }, response.status);
      }

      const text = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text;
      return corsResponse(JSON.parse(text || "{}"));
    } catch (error) {
      return corsResponse({ error: "Worker failed", detail: String(error?.message || error) }, 500);
    }
  },
};

function corsResponse(body, status = 200) {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
