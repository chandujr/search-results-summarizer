const cheerio = require("cheerio");
const DOMPurify = require("isomorphic-dompurify");
const config = require("../settings");

function formatDateWithPrefix(date) {
  return `Published date: ${date || "Unknown"}`;
}

function formatDate(date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();

  return `${month} ${day}, ${year}`;
}

// Parse relative dates ("5 minutes ago", "2 days ago")
function parseRelativeDate(dateStr) {
  const now = new Date();

  const minutesMatch = dateStr.match(/(\d+)\s*minutes?\s*ago/i);
  const hoursMatch = dateStr.match(/(\d+)\s*hours?\s*ago/i);
  const daysMatch = dateStr.match(/(\d+)\s*days?\s*ago/i);

  if (minutesMatch) {
    const minutes = parseInt(minutesMatch[1]);
    now.setMinutes(now.getMinutes() - minutes);
    return formatDate(now);
  }

  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1]);
    now.setHours(now.getHours() - hours);
    return formatDate(now);
  }

  if (daysMatch) {
    const days = parseInt(daysMatch[1]);
    now.setDate(now.getDate() - days);
    return formatDate(now);
  }

  return null;
}

// Parse absolute dates ("28 Nov 2025", "1 Dec 24", "22nd Jan 26")
function parseAbsoluteDate(dateStr) {
  // Check for 4get format: "1 Dec 24" or "22nd Jan 26" (2-digit year)
  const fourgetMatch = dateStr.match(/(\d+)(?:st|nd|rd|th)?\s+(\w+)\s+(\d{2})/);
  if (fourgetMatch) {
    const day = fourgetMatch[1];
    const month = fourgetMatch[2];
    const year = `20${fourgetMatch[3]}`;

    return `${month} ${day}, ${year}`;
  }

  // Check for SearXNG format: "28 Nov 2025" or "3rd Feb 2023" (4-digit year)
  const searxngMatch = dateStr.match(/(\d+)(?:st|nd|rd|th)?\s+(\w+)\s+(\d{4})/);
  if (searxngMatch) {
    const day = searxngMatch[1];
    const month = searxngMatch[2];
    const year = searxngMatch[3];

    return `${month} ${day}, ${year}`;
  }

  return null;
}

function format4getDate(dateText) {
  // 4get format: "1 Dec 24 @ 14:30"
  const dateOnly = dateText.split("@")[0].trim();
  return parseAbsoluteDate(dateOnly);
}

function parseSearxngDate(content) {
  // Searxng format: "28 Nov 2025 — article content here"
  const parts = content.split("—");

  if (parts.length > 1) {
    const datePart = parts[0].trim();

    // First try to parse as relative date
    let parsedDate = parseRelativeDate(datePart);

    // If not a relative date, try to parse as absolute date
    if (!parsedDate) {
      parsedDate = parseAbsoluteDate(datePart);
    }

    return {
      date: parsedDate,
      content: parts.slice(1).join("—").trim(),
    };
  }

  return { date: null, content };
}

// Rewrite URLs in HTML to point to our proxy instead of the original search engine
function rewriteUrls(html) {
  if (config.ENGINE_NAME === "4get") {
    html = html.replace(/action=["']\/web["']/gi, 'action="/search"');
    html = html.replace(/action=["']web["']/gi, 'action="/search"');
    html = html.replace(/href=["']\/web\?s=/gi, 'href="/search?q=');
    html = html.replace(/href=["']\/(\w+)\?s=/gi, 'href="/$1?q=');
    html = html.replace(/name=["']s["']/gi, 'name="q"');
    html = html.replace(/src=["']\/proxy\?i=/gi, 'src="/proxy?i=');
  } else if (config.ENGINE_NAME === "searxng") {
    html = html.replace(/action=["']\/search["']/gi, 'action="/search"');
    html = html.replace(/href=["']\/search\?q=/gi, 'href="/search?q=');
  }
  return html;
}

function extractResults(html) {
  const $ = cheerio.load(html);
  const results = [];

  if (config.ENGINE_NAME === "4get") {
    // Extract search results from 4get HTML structure

    $(".text-result").each((i, elem) => {
      const $elem = $(elem);
      const $parent = $elem.parent();

      const $firstChild = $parent.children().first();
      const hasAnswerTitle = $firstChild.hasClass("answer-title");

      let shouldInclude = false;

      if (hasAnswerTitle) {
        const titleText = $firstChild.find("h2").text().toLowerCase();
        if (titleText.includes("news")) {
          shouldInclude = true;
        }
      } else if ($firstChild.hasClass("text-result")) {
        shouldInclude = true;
      }

      if (!shouldInclude) {
        return; // Skip this element
      }

      const title = $elem.find(".title").first().text().trim();
      const url = $elem.find("a.hover").first().attr("href");
      const content = $elem.find(".description").first().text().trim();
      let dateElem = $elem.find(".greentext").first();
      const date = formatDateWithPrefix(dateElem.length > 0 ? format4getDate(dateElem.text().trim()) : null);

      if (title && url) {
        results.push({ title, url, content, date });
      }
    });
  } else {
    // Extract search results from SearXNG HTML structure

    $(".result").each((i, elem) => {
      const $elem = $(elem);
      const title = $elem.find("h3 a").first().text().trim();
      const url = $elem.find("h3 a").first().attr("href");
      const fullContent = $elem.find(".content").first().text();

      const { date: extractedDate, content } = parseSearxngDate(fullContent);
      const date = formatDateWithPrefix(extractedDate);

      if (title && url) {
        results.push({ title, url, content, date });
      }
    });
  }

  return results;
}

function injectSummary(html, query, results, summaryTemplate, isManualMode = false) {
  if (!results || results.length === 0) {
    return html;
  }

  const sanitizedQuery = DOMPurify.sanitize(query);
  const sanitizedResults = results.map((result) => ({
    title: DOMPurify.sanitize(result.title || ""),
    url: result.url,
    content: DOMPurify.sanitize(result.content || ""),
    date: result.date,
  }));

  let model_name = config.MODEL_ID.split("/")[1] || config.MODEL_ID;
  // make it pretty
  model_name = model_name.replace(/(^|[^a-zA-Z])[a-z]/g, (match) => match.toUpperCase());
  let provider_name = config.AI_PROVIDER === "openrouter" ? "OpenRouter" : "Ollama";

  // Replace placeholders in the template with actual values
  const summaryHTML = summaryTemplate
    .replace(/{{MODEL_NAME}}/g, model_name)
    .replace(/{{PROVIDER_NAME}}/g, provider_name)
    .replace(/{{QUERY_JSON}}/g, JSON.stringify(sanitizedQuery))
    .replace(/{{RESULTS_JSON}}/g, JSON.stringify(sanitizedResults))
    .replace(/{{IS_MANUAL_MODE}}/g, isManualMode);

  // Rewrite URLs in the original HTML
  html = rewriteUrls(html);

  const $ = cheerio.load(html);

  if (config.ENGINE_NAME === "4get") {
    const leftDiv = $(".left").first();
    if (leftDiv.length) {
      leftDiv.prepend(summaryHTML);
    }
  } else if (config.ENGINE_NAME === "searxng") {
    const urlsDiv = $("#urls").first();
    if (urlsDiv.length) {
      urlsDiv.prepend(summaryHTML);
    }
  }

  return $.html();
}

module.exports = {
  rewriteUrls,
  extractResults,
  injectSummary,
};
