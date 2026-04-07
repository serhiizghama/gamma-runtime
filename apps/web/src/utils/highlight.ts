import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);

// Aliases
hljs.registerAliases(['js'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx', 'jsx'], { languageName: 'typescript' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['html', 'htm', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });

/**
 * Highlight code with optional language hint.
 * Returns HTML string with hljs span classes.
 */
export function highlightCode(code: string, language?: string): string {
  if (language) {
    try {
      return hljs.highlight(code, { language }).value;
    } catch {
      // Language not registered — fall through to auto
    }
  }
  try {
    return hljs.highlightAuto(code).value;
  } catch {
    return code;
  }
}
