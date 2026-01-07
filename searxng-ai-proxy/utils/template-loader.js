const fs = require("fs");
const path = require("path");
const config = require("../config");
const { log } = require("./logger");

// Cache for loaded templates
let activeTemplate;
let summaryTemplateSearxng;
let summaryTemplate4get;

/**
 * Load and cache the HTML templates based on search engine type
 */
function loadTemplates() {
  try {
    // Always load both templates for flexibility
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

/**
 * Get the currently active template
 * @returns {string} - Active template content
 */
function getActiveTemplate() {
  if (!activeTemplate) {
    loadTemplates();
  }
  return activeTemplate;
}

/**
 * Reload templates
 */
function reloadTemplates() {
  return loadTemplates();
}

module.exports = {
  loadTemplates,
  getActiveTemplate,
  reloadTemplates,
};
