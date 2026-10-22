import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const html=readFileSync('public/index.html','utf8');for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(m[1]);assert.match(html,/SMIT/);assert.ok(!html.includes('detail-approve'));assert.ok(!html.includes('detail-review'));console.log('HTML e JavaScript verificados; fluxo sem aprovação interna.');
