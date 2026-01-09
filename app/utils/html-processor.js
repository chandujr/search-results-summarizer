const cheerio = require("cheerio");
const config = require("../settings");

// Rewrite URLs in HTML to point to our proxy instead of the original search engine
function rewriteUrls(html) {
  if (config.ENGINE_NAME === "4get") {
    html = html.replace(/action=["']\/web["']/gi, 'action="/web"');
    html = html.replace(/href=["']\/web\?s=/gi, 'href="/web?s=');
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
      const title = $elem.find(".title").first().text().trim();
      const url = $elem.find("a.hover").first().attr("href");
      const content = $elem.find(".description").first().text().trim();

      if (title && url) {
        results.push({ title, url, content });
      }
    });
  } else {
    // Extract search results from SearXNG HTML structure
    $(".result").each((i, elem) => {
      const $elem = $(elem);
      const title = $elem.find("h3 a").first().text().trim();
      const url = $elem.find("h3 a").first().attr("href");
      const content = $elem.find(".content").first().text().trim();

      if (title && url) {
        results.push({ title, url, content });
      }
    });
  }

  return results;
}

function injectSummary(html, query, results, summaryTemplate) {
  if (!results || results.length === 0) {
    return html;
  }

  // Replace placeholders in the template with actual values
  let summaryHTML = summaryTemplate
    .replace(/{{MODEL_NAME}}/g, config.OPENROUTER_MODEL.split("/")[1] || "AI")
    .replace(/{{QUERY_JSON}}/g, JSON.stringify(query))
    .replace(/{{RESULTS_JSON}}/g, JSON.stringify(results));

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
