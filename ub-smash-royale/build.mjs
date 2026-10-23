// builds this folder's page. the builder is series/shared/site.mjs and the page settings are in series/configs.mjs.
// two views: index.html counts the off-week club nights and on-weeks-only.html leaves them out. winners
// and matchups only ever count the numbered nights
import { buildSite } from '../series/shared/site.mjs';
buildSite('ub-smash-royale');
buildSite('ub-smash-royale', { countOffweeks: false, htmlFile: 'on-weeks-only.html', writeFiles: false });
