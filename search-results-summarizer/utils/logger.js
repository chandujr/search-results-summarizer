// Logger utility for Search Results Summarizer
function log(message) {
  const now = new Date();
  const time = now.toTimeString().split(" ")[0];
  console.log(`[${time}] ${message}`);
}

module.exports = {
  log,
};
