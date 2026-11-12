const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'src','vendor');fs.mkdirSync(out,{recursive:true});
const files={
  'tom-select/dist/js/tom-select.complete.min.js':'tom-select.js',
  'tom-select/dist/css/tom-select.css':'tom-select.css',
  'tom-select/LICENSE':'tom-select.LICENSE',
  'flatpickr/dist/flatpickr.min.js':'flatpickr.js',
  'flatpickr/dist/flatpickr.min.css':'flatpickr.css',
  'flatpickr/dist/l10n/zh.js':'flatpickr-zh.js',
  'flatpickr/LICENSE.md':'flatpickr.LICENSE',
  'fullcalendar/index.global.min.js':'fullcalendar.js',
  'fullcalendar/LICENSE.md':'fullcalendar.LICENSE'
};
for(const [from,to]of Object.entries(files))fs.copyFileSync(path.join(root,'node_modules',from),path.join(out,to));
console.log('Vendored Tom Select, Flatpickr and FullCalendar with licenses.');
require('esbuild').buildSync({entryPoints:[path.join(__dirname,'floating-entry.js')],bundle:true,minify:true,format:'iife',globalName:'FloatingUIDOM',outfile:path.join(out,'floating-ui.js'),platform:'browser'});
for(const name of ['dom','core','utils'])fs.copyFileSync(path.join(root,'node_modules','@floating-ui',name,'LICENSE'),path.join(out,`floating-ui-${name}.LICENSE`));
