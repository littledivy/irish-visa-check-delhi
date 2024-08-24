import XLSX from "jsr:@mirror/xlsx@0.20.3";
import { router } from "https://deno.land/x/rutt@0.2.0/mod.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

async function sendEmail(subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Ireland Visa check <ireland-visa-check@littledivy.com>",
      to: ["dj.srivastava23@gmail.com"],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    console.error("Failed to send email", res.status, await res.text());
  }

  return res;
}

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36 Edge/16.16299",
};

const base = "https://www.ireland.ie";

const storePath = Deno.env.get("STORAGE_PATH") || "store.json";

function fetchAndDecode<T>(
  url: string,
  decoder: (data: ArrayBuffer) => T,
): Promise<T> {
  return fetch(url, {
    method: "GET",
    headers,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      } else {
        return response.arrayBuffer();
      }
    })
    .then(decoder);
}

async function getDecisions(path: string): Promise<Record<string, string>> {
  const sheet = await fetchAndDecode(
    `${base}${path}`,
    XLSX.read,
  );

  const sheetName = sheet.SheetNames[0];
  if (!sheetName) {
    throw new Error("No sheet found");
  }
  const worksheet = sheet.Sheets[sheetName];
  console.log(`Using sheet: ${sheetName}`);

  const json: string[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  let startRow = 0;
  for (let i = 0; i < json.length; i++) {
    const row = json[i];
    if (row[2] === "Approved" || row[2] === "Refused") {
      startRow = i;
      break;
    }
  }

  const map: Record<string, string> = {};
  for (let i = startRow; i < json.length; i++) {
    const row = json[i];
    const id = row[1];
    const status = row[2];
    if (id && status) {
      map[id] = status;
    }
  }

  return map;
}

async function scrapeLink(): Promise<string> {
  return fetch(
    `${base}/en/india/newdelhi/services/visas/processing-times-and-decisions/`,
    {
      method: "GET",
      headers,
    },
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      } else {
        return response.text();
      }
    })
    .then((html) => {
      const regex = /href="([^"]*\.ods)"/;
      const match = html.match(regex);
      if (!match) {
        throw new Error("No link found");
      }
      return match[1];
    });
}

async function job() {
  const link = await scrapeLink();
  const decisions = await getDecisions(link);

  await Deno.writeTextFile(storePath, JSON.stringify(decisions));

  if (decisions["69349742"]) {
    await sendEmail(
      "Your visa decisions is out!",
      "<p>Your visa decision is out. Check it <a href='https://irish-visa-check.fly.dev/decision/69349742'>here</a></p>",
    );
  }
  await sendEmail(
    "New decisions available",
    "<p>Decisions have been updated at <a href='https://irish-visa-check.fly.dev'>irish-visa-check.fly.dev</a></p>",
  );
}

Deno.cron("collect decisions", "0 */12 * * *", job);

const index = await Deno.readTextFile("index.html");

Deno.serve(
  { port: 1234 },
  router({
    "/": () =>
      new Response(index, { headers: { "content-type": "text/html" } }),
    "/decision/:id": async (req, _, { id }) => {
      if (!id) return new Response("No ID provided", { status: 400 });

      const store = JSON.parse(await Deno.readTextFile(storePath));
      const decision = store[id];
      if (!decision) return new Response("No decision found", { status: 404 });

      return new Response(decision as any);
    },
    "/run-job": async () => {
      await job();
      return new Response("Job ran successfully");
    },
  }),
);
