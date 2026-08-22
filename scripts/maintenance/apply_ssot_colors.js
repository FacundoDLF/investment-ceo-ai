const fs = require('fs');

function replaceRegexAll(content, searchRegex, replacer) {
  return content.replace(searchRegex, replacer);
}

function processFile(filepath) {
  let content = fs.readFileSync(filepath, 'utf8');
  let original = content;

  // Single quote to template literal with LOG_PREFIX
  content = content.replace(/'\\x1b\[35m\[Sistema\]\\x1b\[0m(.*?)'/g, "`\\${LOG_PREFIX.SISTEMA}$1`");
  content = content.replace(/'\\x1b\[35m\[Scrappy\]\\x1b\[0m(.*?)'/g, "`\\${LOG_PREFIX.SCRAPPY}$1`");
  content = content.replace(/'\\x1b\[35m\[Richard Newman\]\\x1b\[0m(.*?)'/g, "`\\${LOG_PREFIX.RICHARD_NEWMAN}$1`");
  content = content.replace(/'\\x1b\[35m\[Rick Queen\]\\x1b\[0m(.*?)'/g, "`\\${LOG_PREFIX.RICK_QUEEN}$1`");
  content = content.replace(/'\\x1b\[35m\[Markus Skinner\]\\x1b\[0m(.*?)'/g, "`\\${LOG_PREFIX.MARKUS_SKINNER}$1`");
  content = content.replace(/'\\x1b\[35m\[Experto S\.M\.A\.R\.T\]\\x1b\[0m(.*?)'/g, "`\\${LOG_PREFIX.EXPERTO_SMART}$1`");
  content = content.replace(/'\\x1b\[31m\[Richard Newman\] Error crítico:\\x1b\[0m(.*?)'/g, "`\\${LOG_PREFIX.SISTEMA_CRITICO} [Richard Newman] Error crítico:\\${ANSI_COLORS.RESET}$1`");
  
  // Template literal (backticks) replacements
  content = content.replace(/\\x1b\[31m\[Sistema\] Advertencia: El LLM alucinó la herramienta o violó el formato JSON. Reintentando\.\.\.\\x1b\[0m/g, "\\${LOG_PREFIX.SISTEMA_CRITICO} Advertencia: El LLM alucinó la herramienta o violó el formato JSON. Reintentando...\\${ANSI_COLORS.RESET}");
  content = content.replace(/\\x1b\[36m\[CEO Trader\] Razonando:\\x1b\[0m/g, "\\${LOG_PREFIX.CEO_TRADER} Razonando:\\${ANSI_COLORS.RESET}");
  content = content.replace(/\\x1b\[36m\[CEO Trader\] /g, "\\${LOG_PREFIX.CEO_TRADER} ");
  content = content.replace(/\\x1b\[36m\[CEO Trader\]\\x1b\[0m/g, "\\${LOG_PREFIX.CEO_TRADER}");
  content = content.replace(/\\x1b\[37m/g, "\\${ANSI_COLORS.WHITE}");
  content = content.replace(/\\x1b\[0m/g, "\\${ANSI_COLORS.RESET}");
  content = content.replace(/\\x1b\[32m/g, "\\${ANSI_COLORS.GREEN}");
  content = content.replace(/\\x1b\[31m/g, "\\${ANSI_COLORS.RED}");
  content = content.replace(/\\x1b\[35m/g, "\\${ANSI_COLORS.MAGENTA}");
  content = content.replace(/\\x1b\[33m/g, "\\${ANSI_COLORS.YELLOW}");

  // Fix specific known bugs
  content = content.replace(/`\$\{ANSI_COLORS\.GREEN\}\[Sistema\]\$\{ANSI_COLORS\.RESET\}/g, "${LOG_PREFIX.SISTEMA_OK}");
  content = content.replace(/`\$\{ANSI_COLORS\.MAGENTA\}\[Scrappy\]\$\{ANSI_COLORS\.RESET\}/g, "${LOG_PREFIX.SCRAPPY}");
  content = content.replace(/`\$\{ANSI_COLORS\.MAGENTA\}\[Richard Newman\]\$\{ANSI_COLORS\.RESET\}/g, "${LOG_PREFIX.RICHARD_NEWMAN}");
  content = content.replace(/`\$\{ANSI_COLORS\.MAGENTA\}\[Rick Queen\]\$\{ANSI_COLORS\.RESET\}/g, "${LOG_PREFIX.RICK_QUEEN}");
  content = content.replace(/`\$\{ANSI_COLORS\.MAGENTA\}\[Markus Skinner\]\$\{ANSI_COLORS\.RESET\}/g, "${LOG_PREFIX.MARKUS_SKINNER}");
  content = content.replace(/`\$\{ANSI_COLORS\.MAGENTA\}\[Experto S\.M\.A\.R\.T\]\$\{ANSI_COLORS\.RESET\}/g, "${LOG_PREFIX.EXPERTO_SMART}");
  content = content.replace(/`\$\{ANSI_COLORS\.YELLOW\}\[PAPER MODE\]\$\{ANSI_COLORS\.RESET\}/g, "${LOG_PREFIX.PAPER_MODE}");
  content = content.replace(/`\$\{ANSI_COLORS\.RED\}\[Broker Error\]\$\{ANSI_COLORS\.RESET\}/g, "${LOG_PREFIX.BROKER_ERROR}");
  content = content.replace(/`\$\{ANSI_COLORS\.RED\}\[API\]/g, "`${LOG_PREFIX.API}");
  content = content.replace(/`\$\{ANSI_COLORS\.RED\}\[Model Fallback\]\$\{ANSI_COLORS\.RESET\}/g, "${LOG_PREFIX.MODEL_FALLBACK}");
  content = content.replace(/`\$\{ANSI_COLORS\.RED\}\[API Groq\]/g, "`${LOG_PREFIX.API}");

  if (content !== original) {
    if (!content.includes('LOG_PREFIX')) {
      const importRegex = /^import\s+.*?;?\s*$/gm;
      let match;
      let lastImportIndex = 0;
      while ((match = importRegex.exec(content)) !== null) {
        lastImportIndex = match.index + match[0].length;
      }
      const imp = "import { LOG_PREFIX, ANSI_COLORS } from '@/shared/constants/colors';\n";
      if (lastImportIndex > 0) {
        content = content.slice(0, lastImportIndex) + '\n' + imp + content.slice(lastImportIndex);
      } else {
        content = imp + content;
      }
    }
    fs.writeFileSync(filepath, content);
    console.log(filepath, 'updated');
  }
}

const files = [
  'src/processes/daemon/scrappy.loop.ts',
  'src/features/agent/services/agent.service.ts',
  'src/features/agent/sub-agents/scrappy.agent.ts',
  'src/features/agent/sub-agents/research.agent.ts',
  'src/features/agent/sub-agents/quant.agent.ts',
  'src/features/agent/sub-agents/market-scanner.agent.ts',
  'src/features/agent/tools/execute-trade.tool.ts',
  'src/features/agent/tools/consult-analyst.tool.ts',
  'src/shared/lib/groq.ts'
];

for (const f of files) {
  processFile(f);
}
