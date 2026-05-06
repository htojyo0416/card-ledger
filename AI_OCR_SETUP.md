# AI OCR setup

Browser OCR with Tesseract.js is not reliable enough for Japanese business cards. Use this Worker as a small private OCR backend.

## Deploy with Cloudflare Workers

1. Create a Cloudflare account.
2. Open **Workers & Pages**.
3. Create a Worker.
4. Replace the Worker code with `openai-worker.js`.
5. Add a secret named `OPENAI_API_KEY`.
6. Optionally add `OPENAI_MODEL`. Default is `gpt-5.4-mini`.
7. Deploy the Worker and copy its URL.
8. Open Card Ledger, paste the Worker URL into **AI OCR URL**, and press **URL保存**.

After that, images will be sent to the Worker for AI OCR, then the app will fill the business card fields.

Do not put your OpenAI API key directly into GitHub Pages or frontend JavaScript.
