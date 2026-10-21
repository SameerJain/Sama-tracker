// Builds ub-smash-royale/ viewer. Shared builder: series/shared/site.mjs, config: series/configs.mjs.
// Two views of the same page: index.html counts the off-week club nights,
// on-weeks-only.html drops them. Winners and matchups are numbered-only in both.
import { buildSite } from '../series/shared/site.mjs';
buildSite('ub-smash-royale');
buildSite('ub-smash-royale', { countOffweeks: false, htmlFile: 'on-weeks-only.html', writeFiles: false });
