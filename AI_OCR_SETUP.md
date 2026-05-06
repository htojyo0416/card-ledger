# AI OCR setup

The browser OCR is not accurate enough for Japanese business cards. This setup keeps the app on GitHub Pages and sends only the OCR request to a Cloudflare Worker. The OpenAI API key stays private in Cloudflare.

## Files

- `openai-worker.js`: Worker backend that calls OpenAI Vision.
- `wrangler.jsonc`: Worker deploy config.
- `index.html`, `app.js`, `styles.css`, `sw.js`: GitHub Pages app files.

## Cloudflare dashboard setup

1. Create or sign in to a Cloudflare account.
2. Open **Workers & Pages**.
3. Click **Create**.
4. Choose **Worker**.
5. Create a Worker named `card-ledger-ai-ocr`.
6. Open the Worker editor and replace the code with `openai-worker.js`.
7. Deploy once.
8. Open the Worker **Settings**.
9. Open **Variables and Secrets**.
10. Add a **Secret** named `OPENAI_API_KEY`.
11. Paste your OpenAI API key as the value.
12. Add a normal text variable named `OPENAI_MODEL` with value `gpt-5.4-mini`.
13. Deploy again.
14. Copy the Worker URL, for example `https://card-ledger-ai-ocr.your-name.workers.dev`.
15. Open Card Ledger, paste that URL into **AI OCR URL**, and press **URL保存**.

## Wrangler setup

If you prefer command line deployment:

```powershell
npm create cloudflare@latest card-ledger-ai-ocr
```

Then replace the generated Worker code with `openai-worker.js`, copy `wrangler.jsonc`, and deploy:

```powershell
npx wrangler secret put OPENAI_API_KEY
npx wrangler deploy
```

## Important

Do not put `OPENAI_API_KEY` into GitHub Pages, `app.js`, `index.html`, or any public repository file.

Cloudflare documents recommend secrets for sensitive values. OpenAI's Responses API supports image input and structured JSON output, which this Worker uses for business card extraction.
