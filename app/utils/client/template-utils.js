/**
 * Template utility functions for processing LaTeX math expressions and code blocks
 * These functions are shared across different search engine templates
 */

/**
 * Process LaTeX expressions in HTML and render them using KaTeX
 * @param {string} html - HTML content with potential LaTeX expressions
 * @returns {string} - HTML with rendered LaTeX expressions
 */
function processLatexInHTML(html) {
  if (typeof katex === "undefined") {
    console.warn("KaTeX is not loaded. LaTeX expressions will not be rendered.");
    return html;
  }

  const renderLatex = (tex, displayMode, fallback) => {
    try {
      return katex.renderToString(tex.trim(), {
        displayMode: displayMode,
        throwOnError: false,
      });
    } catch (e) {
      console.error("KaTeX rendering error:", e, "LaTeX:", tex);
      return fallback;
    }
  };

  // PRIORITY 1: Process escaped delimiters first (standard LaTeX)

  // 1. Escaped square brackets \[ ... \]
  html = html.replace(/\\\\\[([\s\S]*?)\\\\\]/g, (match, tex) => {
    return renderLatex(tex, true, match);
  });
  html = html.replace(/\\\[(.+?)\\\]/gs, (match, tex) => {
    return renderLatex(tex, true, match);
  });

  // 2. Double dollar signs $$ ... $$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, tex) => {
    return renderLatex(tex, true, match);
  });

  // 3. Escaped parentheses \( ... \)
  html = html.replace(/\\\\\(([\s\S]*?)\\\\\)/g, (match, tex) => {
    return renderLatex(tex, false, match);
  });
  html = html.replace(/\\\((.+?)\\\)/gs, (match, tex) => {
    return renderLatex(tex, false, match);
  });

  // 4. Single dollar signs $ ... $
  html = html.replace(/\$([^$\n]+?)\$/g, (match, tex) => {
    return renderLatex(tex, false, match);
  });

  // PRIORITY 2: Process plain delimiters

  // 5. Plain square brackets [ ... ]
  html = html.replace(/\[\s*([^\]]*\\[^\]]*)\s*\]/g, (match, tex) => {
    return renderLatex(tex, true, match);
  });

  // 6. Plain parentheses ( ... )
  html = html.replace(/\(\s*([^)]+?)\s*\)/g, (match, tex, offset, fullString) => {
    const trimmed = tex.trim();

    if (/<[^>]+>/.test(trimmed)) {
      return match;
    }

    // Check if we're inside a code or pre block
    const beforeMatch = fullString.substring(0, offset);

    const lastCodeOpen = beforeMatch.lastIndexOf("<code");
    const lastCodeClose = beforeMatch.lastIndexOf("</code>");
    const lastPreOpen = beforeMatch.lastIndexOf("<pre");
    const lastPreClose = beforeMatch.lastIndexOf("</pre>");

    const isInCodeBlock = lastCodeOpen > lastCodeClose;
    const isInPreBlock = lastPreOpen > lastPreClose;

    if (isInCodeBlock || isInPreBlock) {
      return match;
    }

    // Skip prose patterns
    if (
      /\s+\w+\s+/.test(trimmed) ||
      /\w-\w/.test(trimmed) ||
      /\b(the|a|an|and|or|of|in|for|to|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|should|could|may|might|must|can)\b/i.test(
        trimmed,
      )
    ) {
      return match;
    }

    // Only process if it contains LaTeX-specific syntax
    const hasBackslash = /\\/.test(trimmed); // LaTeX commands like \pi, \cos
    const hasLatexChars = /[\^_{}]/.test(trimmed); // LaTeX special chars
    const isSingleLetter = /^[a-zA-Z]$/.test(trimmed); // Single variable like ( m )
    const isFunctionNotation = /^[a-zA-Z]+\([^)]*\)$/.test(trimmed); // Math functions like V(x)

    // ONLY process if it has LaTeX indicators or is a simple math variable
    if (hasBackslash || hasLatexChars || isSingleLetter || isFunctionNotation) {
      return renderLatex(trimmed, false, match);
    }

    // Skip everything else - even if it looks like math with operators
    // This prevents converting things like (m1 * m2) which are fine as plain text
    return match;
  });

  return html;
}

/**
 * Preprocess LaTeX expressions in markdown to protect them from markdown parser
 * @param {string} markdown - Markdown content with LaTeX expressions
 * @returns {Object} - Object with processed markdown and array of LaTeX blocks
 */
function preprocessLatex(markdown) {
  const latexBlocks = [];
  let index = 0;

  // Match $$ that might be on their own line, with content on following lines
  markdown = markdown.replace(/\$\$\s*\n([\s\S]*?)\n\s*\$\$/g, (match, content) => {
    const placeholder = `LTXD${index}D`;
    // Keep the delimiters but put everything on one line
    latexBlocks[index] = { type: "display-dollar", content: `$$${content.trim()}$$` };
    index++;
    return placeholder;
  });

  // Also handle $$ ... $$ on the same line (fallback)
  markdown = markdown.replace(/\$\$([\s\S]+?)\$\$/g, (match) => {
    const placeholder = `LTXD${index}D`;
    latexBlocks[index] = { type: "display-dollar", content: match };
    index++;
    return placeholder;
  });

  // Handle \[ ... \] with potential newlines
  markdown = markdown.replace(/\\\[\s*\n([\s\S]*?)\n\s*\\\]/g, (match, content) => {
    const placeholder = `LTXD${index}D`;
    latexBlocks[index] = { type: "display-bracket", content: `\\[${content.trim()}\\]` };
    index++;
    return placeholder;
  });

  markdown = markdown.replace(/\\\[([\s\S]+?)\\\]/g, (match) => {
    const placeholder = `LTXD${index}D`;
    latexBlocks[index] = { type: "display-bracket", content: match };
    index++;
    return placeholder;
  });

  // Inline math - these should be on one line already
  markdown = markdown.replace(/\\\((.+?)\\\)/g, (match) => {
    const placeholder = `LTXI${index}I`;
    latexBlocks[index] = { type: "inline-paren", content: match };
    index++;
    return placeholder;
  });

  markdown = markdown.replace(/\$([^$\n]+?)\$/g, (match) => {
    const placeholder = `LTXI${index}I`;
    latexBlocks[index] = { type: "inline-dollar", content: match };
    index++;
    return placeholder;
  });

  return { markdown, latexBlocks };
}

/**
 * Restore LaTeX expressions in HTML after markdown processing
 * @param {string} html - HTML with LaTeX placeholders
 * @param {Array} latexBlocks - Array of LaTeX blocks from preprocessLatex
 * @returns {string} - HTML with restored LaTeX expressions
 */
function restoreLatex(html, latexBlocks) {
  latexBlocks.forEach((block, index) => {
    const placeholder = block.type.startsWith("display") ? `LTXD${index}D` : `LTXI${index}I`;

    html = html.replace(new RegExp(placeholder, "g"), block.content);
  });
  return html;
}

/**
 * Process code blocks in HTML to ensure proper formatting
 * @param {string} html - HTML content with potential code blocks
 * @returns {string} - HTML with properly formatted code blocks
 */
function processCodeBlocks(html) {
  const languages = [
    "java",
    "javascript",
    "python",
    "js",
    "py",
    "html",
    "css",
    "sql",
    "json",
    "xml",
    "yaml",
    "yml",
    "sh",
    "bash",
    "php",
    "ruby",
    "go",
    "rust",
    "c\\+\\+",
    "cpp",
    "c",
    "csharp",
    "c#",
    "swift",
    "kotlin",
    "scala",
    "typescript",
    "ts",
    "perl",
    "r",
    "dart",
    "lua",
    "vim",
  ];

  // Create regex pattern for language matching
  const langPattern = languages.join("|");
  const langIdentifierRegex = new RegExp(`^(${langPattern})$`, "i");

  const wrapCodeBlock = (language, code) => {
    return `<pre><code class="language-${language}">${code}</code></pre>`;
  };

  // 1. Fix standalone code blocks with language identifiers
  // Matches: <code>languageName\n...code...</code> (not already in <pre>)
  html = html.replace(/<code>([a-zA-Z0-9+#\-_]+)\n([\s\S]*?)<\/code>(?!<\/pre>)/g, (match, language, code) => {
    // Only wrap if it's a recognized language
    if (langIdentifierRegex.test(language)) {
      return wrapCodeBlock(language, code);
    }
    return match; // Keep original if not a language identifier
  });

  // 2. Fix code blocks within list items
  // Matches: <li>...text...<code>language\n...code...</code>...text...</li>
  html = html.replace(
    /<li>([^<]*)<code>([a-zA-Z0-9+#\-_]+)\n([\s\S]*?)<\/code>([^<]*)<\/li>/g,
    (match, textBefore, language, code, textAfter) => {
      // Only wrap if it's a recognized language
      if (langIdentifierRegex.test(language)) {
        return `<li>${textBefore}${wrapCodeBlock(language, code)}${textAfter}</li>`;
      }
      return match; // Keep original if not a language identifier
    },
  );

  return html;
}

/**
 * Process markdown content with LaTeX and code block support
 * @param {string} markdown - Raw markdown content
 * @param {Object} converter - Showdown converter instance
 * @param {Function} sanitizeFunction - Function to sanitize HTML (e.g., DOMPurify.sanitize)
 * @returns {string} - Processed HTML with LaTeX and properly formatted code blocks
 */
function processMarkdownWithLatexAndCodeBlocks(markdown, converter, sanitizeFunction) {
  // Step 1: Preprocess LaTeX to protect it from markdown parser
  const { markdown: protectedMarkdown, latexBlocks } = preprocessLatex(markdown);

  // Step 2: Convert markdown to HTML
  let html = converter.makeHtml(protectedMarkdown);

  // Step 3: Restore LaTeX expressions
  html = restoreLatex(html, latexBlocks);

  // Step 4: Process LaTeX expressions in HTML
  html = processLatexInHTML(html);

  // Step 5: Process code blocks
  html = processCodeBlocks(html);

  // Step 6: Sanitize HTML with additional tags for LaTeX
  const sanitizedHTML = sanitizeFunction(html, {
    ADD_TAGS: [
      "annotation",
      "semantics",
      "math",
      "mi",
      "mn",
      "mo",
      "mrow",
      "msup",
      "msubsup",
      "mfrac",
      "msqrt",
      "mroot",
    ],
    ADD_ATTR: ["xmlns"],
  });

  return sanitizedHTML;
}

window.TemplateUtils = {
  processLatexInHTML,
  preprocessLatex,
  restoreLatex,
  processCodeBlocks,
  processMarkdownWithLatexAndCodeBlocks,
};
