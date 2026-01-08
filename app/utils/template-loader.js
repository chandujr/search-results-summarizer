const fs = require("fs");
const path = require("path");
const config = require("../settings");
const { log } = require("./logger");

// Cache for loaded templates to avoid repeated file reads
let activeTemplate;
let summaryTemplateSearxng;
let summaryTemplate4get;

function loadTemplates() {
  try {
    // Always load both templates for flexibility when switching engines
    summaryTemplateSearxng = fs.readFileSync(config.SEARXNG_TEMPLATE, "utf8");
    summaryTemplate4get = fs.readFileSync(config.FOURGET_TEMPLATE, "utf8");

    activeTemplate = config.ENGINE_NAME === "4get" ? summaryTemplate4get : summaryTemplateSearxng;

    log(`Summary template loaded for ${config.ENGINE_NAME}`);
    return true;
  } catch (error) {
    console.error("Error loading summary template:", error);
    activeTemplate = "<div>Template loading error</div>";
    return false;
  }
}

function getActiveTemplate() {
  // Load templates if they haven't been loaded yet
  if (!activeTemplate) {
    loadTemplates();
  }
  return activeTemplate;
}

function reloadTemplates() {
  // Force reload of templates from disk
  return loadTemplates();
}

module.exports = {
  loadTemplates,
  getActiveTemplate,
  reloadTemplates,
};
