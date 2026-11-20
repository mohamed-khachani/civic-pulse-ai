import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const runtime = '/Users/mohamedkhachaniupm/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES = path.join(runtime, 'node/node_modules');
const { Presentation, PresentationFile } = await import(pathToFileURL(path.join(process.env.RUNTIME_NODE_MODULES, '@oai/artifact-tool/dist/artifact_tool.mjs')).href);
const skill = '/Users/mohamedkhachaniupm/.codex/plugins/cache/openai-primary-runtime/presentations/26.1118.11504/skills/presentations';
const { finalizePresentation, resolvePresentationFont, applyPresentationChartFont } = await import(pathToFileURL(path.join(skill, 'container_tools/artifact_tool_utils.mjs')).href);
const facts = JSON.parse(await fs.readFile(path.join(here, 'facts.json'), 'utf8'));
const n = facts.counts;
const externalSources = (await Promise.all(facts.station_metadata.map(async (item) => {
  try { return JSON.parse(await fs.readFile(path.join(root, item.provenance), 'utf8')).source_url; } catch { return null; }
}))).filter(Boolean);
const fmt = (value) => new Intl.NumberFormat('es-ES').format(value);
const revision = process.argv[2] || 'v1';
const output = path.join(here, 'output', `Atlas-pitch-4min-${revision}.pptx`);
await fs.mkdir(path.join(here, 'output'), { recursive: true });
const font = resolvePresentationFont();
const colors = {green:'#16803C', dark:'#102D20', cream:'#F5F7F2', ink:'#172B21', muted:'#5A7061', light:'#D9E9DD', white:'#FFFFFF', gold:'#C98928'};
const deck = Presentation.create({slideSize:{width:1280,height:720}});
deck.theme.defaultFont = font;
const notes = [];
function text(slide, content, x,y,w,h, size=24, color=colors.ink, bold=false, align='left') {
  const shape=slide.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
  shape.text=content;
  shape.text.style={typeface:font,fontSize:`${size}pt`,color,bold,alignment:align,verticalAlignment:'middle',autoFit:'none',insets:0};
  return shape;
}
function slide(title, index) {
  const s=deck.slides.add();s.background.fill=colors.cream;
  text(s,title,70,50,1130,82,32,colors.dark,true);
  text(s,`${index} / 7`,1130,662,80,25,12,colors.muted,false,'right');
  return s;
}
function note(s, title, seconds, script, sources) {
  const content=`${title}\nDuración objetivo: ${seconds} segundos\n\n${script}\n\nFuentes y precisión\n${sources.join('\n')}`;
  s.speakerNotes.text=content;
  notes.push({title,seconds,script,sources});
}
function node(s,label,x,y,w=220,h=85,fill=colors.white,size=19) {
  const sh=s.shapes.add({geometry:'rect',position:{left:x,top:y,width:w,height:h},fill,line:{fill:colors.green,width:2}});
  sh.text=label;sh.text.style={typeface:font,fontSize:`${size}pt`,bold:true,color:colors.dark,alignment:'center',verticalAlignment:'middle',autoFit:'none',insets:10};
  return sh;
}
function connect(s,a,b,from='right',to='left') {
  s.shapes.connect(a,b,{kind:'straight',fromSide:from,toSide:to,line:{fill:colors.green,width:3},tail:{type:'triangle',width:'med',length:'med'}});
}
function bar(s,categories,values,position,{max,unit=''}={}) {
  const chart=s.charts.add('bar',{position,categories,series:[{name:unit||'Cantidad',values,fill:colors.green}],hasLegend:false,
    barOptions:{direction:'bar',grouping:'clustered',gapWidth:75},
    xAxis:{visible:true,textStyle:{typeface:font,fontSize:22,fill:colors.muted},line:{fill:'none',width:0},majorGridlines:null},
    yAxis:{visible:true,textStyle:{typeface:font,fontSize:22,fill:colors.muted},min:0,max,majorUnit:max<=5?1:500,majorGridlines:{fill:colors.light,width:1}},
    dataLabels:{showValue:true,position:'outEnd',textStyle:{typeface:font,fontSize:22,bold:true,fill:colors.dark}},
    chartFill:'none',chartLine:{fill:'none',width:0},plotAreaFill:'none',plotAreaLine:{fill:'none',width:0}});
  applyPresentationChartFont(chart,{fontFamily:font});
  return chart;
}

// 1. Minimal cover.
{
 const s=deck.slides.add();s.background.fill=colors.dark;
 text(s,'Atlas',72,88,1100,120,68,colors.white,true);
 text(s,'Encontrar piso también es\nelegir el entorno',76,260,1090,180,38,colors.white);
 text(s,'Alquiler en Madrid con anuncios reales y datos públicos',78,533,1100,60,22,colors.light);
 note(s,'Atlas',20,
 'Buscar piso en Madrid implica comparar anuncios y, después, intentar entender la zona. ¿Encaja el precio? ¿Hay servicios cerca? ¿Cómo afecta a mi rutina? Atlas reúne ambas partes en una misma búsqueda: viviendas reales y datos públicos del entorno, con una conversación en español y un mapa para explorar los resultados.',
 ['README.md','front-end/src/components/app-shell.tsx']);
}
// 2. Native scraping flow.
{
 const s=slide('Anuncios obtenidos mediante web scraping',2);
 const a=node(s,'Fotocasa',75,190,235,88);const b=node(s,'Pisos.com',75,365,235,88);
 const c=node(s,'Páginas HTML\ny extracción',430,267,250,100);
 const d=node(s,'JSON normalizado\ny carga en PostgreSQL',795,267,375,100);
 connect(s,a,c);connect(s,b,c);connect(s,c,d);
 text(s,`${fmt(n.fotocasa)} anuncios`,75,285,260,45,22,colors.green,true);
 text(s,`${fmt(n.pisoscom)} anuncios`,75,460,260,45,22,colors.green,true);
 text(s,fmt(n.listings),795,430,390,90,48,colors.green,true);
 text(s,'registros importados',798,520,350,38,21,colors.muted);
 text(s,'La cifra cuenta anuncios por portal. Una misma vivienda puede aparecer en ambos.',75,594,1100,42,17,colors.muted);
 note(s,'Web scraping',35,
 `Los anuncios proceden de Fotocasa y Pisos.com. Primero descargamos las páginas de resultados y extraemos sus enlaces. Después obtenemos el detalle de cada anuncio y lo convertimos en JSON con precio, características, fotografías y coordenadas. La base contiene ${fmt(n.fotocasa)} registros de Fotocasa y ${fmt(n.pisoscom)} de Pisos.com: ${fmt(n.listings)} en total. Conservamos el JSON original y evitamos duplicar el mismo identificador dentro de cada portal. Esta cifra cuenta anuncios, no viviendas únicas entre portales.`,
 ['tools/fotocasa/listings-extractor/src/scraper.ts','tools/pisos.com/listings-extractor/src/scraper.ts','tools/process-listings/','tools/scraper/','datos/alquileres/ingest.log','datos/alquileres/ingest-fotocasa.log','db/schema.sql']);
}
// 3. Source count and editable chart.
{
 const s=slide(`${n.integrated_local_datasets} datasets locales integrados`,3);
 const groups = {Geografía:['census_topojson','districts','neighbourhoods'],'Población y estudio':['padron','district_study_2026'],'Alquiler de referencia':['rental_section_2024','rental_district_2024','rental_postal_2023'],Servicios:['schools','medical_centres','sports_facilities','libraries'],'Zonas verdes':['parks','park_area_catalogue'],Accidentes:['traffic_accidents','bike_accidents'],'Aire y ruido':['air_quality','noise'],Tráfico:['traffic_zip']};
 const totals = Object.entries(groups).map(([label,ids]) => [label, facts.datasets.filter((d) => d.integrated && ids.includes(d.id)).length]).filter(([,count]) => count>0);
 bar(s,totals.map(([label])=>label),totals.map(([,count])=>count),{left:60,top:170,width:760,height:445},{max:4,unit:'Datasets'});
 text(s,String(n.available_local_datasets),895,188,230,88,48,colors.green,true);
 text(s,'datasets locales disponibles',897,277,300,75,20,colors.muted);
 text(s,`+ ${n.station_metadata_references} referencias`,895,398,300,55,25,colors.dark,true);
 text(s,'para ubicar estaciones\nde aire y ruido',897,458,300,90,20,colors.muted);
 const pending = facts.datasets.filter((d) => !d.integrated);
 const pendingLabel = pending.length ? `Pendientes: ${pending.map((d) => d.name).join(', ')}. Los portales se cuentan aparte.` : 'Todas las fuentes locales tienen integración confirmada. Los portales se cuentan aparte.';
 text(s,pendingLabel,70,607,1120,60,16,colors.muted);
 note(s,'Datasets públicos',40,
 `Además de los portales, partimos de ${n.available_local_datasets} datasets locales. Integramos ${n.integrated_local_datasets}: geografía, padrón y estudio municipal, referencias de alquiler, servicios, zonas verdes, accidentes, aire y ruido. Las mediciones ya estaban descargadas en la carpeta datos. Añadimos dos referencias externas únicamente para situar las estaciones. Distinguimos lo disponible de lo realmente unido. ${pending.length ? `Quedan ${pending.length} fuentes pendientes de revisar o completar geográficamente: ${pending.map((d) => d.name).join(' y ')}.` : 'El informe confirma la integración de todas las fuentes locales.'} Por eso mostramos el número de datasets integrados separado del número de ficheros disponibles.`,
 ['datos/_etl_/paths.json','datos/_etl_/output/coverage_report.json','presentation/facts.json','datos/_etl_/reference_data/air_stations.csv.source.json','datos/_etl_/reference_data/noise_stations.csv.source.json', ...externalSources]);
}
// 4. Data shape and environmental coverage.
{
 const s=slide('Una fila por sección censal',4);
 const a=node(s,'Datos locales',70,166,265,78);const b=node(s,'Limpieza y\nunión espacial',470,166,300,78);const c=node(s,'PostgreSQL\ny PostGIS',900,166,300,78);
 connect(s,a,b);connect(s,b,c);
 text(s,fmt(n.census_sections),70,295,340,90,48,colors.green,true);
 text(s,'secciones de Madrid ciudad',74,385,390,52,20,colors.muted);
 text(s,`${fmt(n.fields_per_section)} campos`,70,474,360,55,31,colors.dark,true);
 text(s,'por fila, con valores ausentes explícitos',74,533,390,75,18,colors.muted);
 text(s,'Cobertura ambiental por sección',550,284,650,45,23,colors.dark,true);
 bar(s,['NO₂','Ruido'],[n.air_sections,n.noise_sections],{left:520,top:345,width:680,height:210},{max:n.census_sections,unit:'Secciones'});
 text(s,'Estimación de la estación más cercana a ≤ 2 km.\nLas zonas sin cobertura mantienen valores ausentes.',550,571,650,62,17,colors.muted);
 note(s,'Integración por sección censal',40,
 `La sección censal es la unidad común. Transformamos los formatos y las coordenadas, situamos los puntos de interés y vinculamos cada anuncio con su sección. Obtenemos ${fmt(n.census_sections)} filas, con ${n.fields_per_section} campos por fila. Los indicadores conservan su año, unidad y escala original, incluso cuando proceden del distrito o del barrio. Para el ambiente usamos las mediciones locales y la estación más cercana dentro de dos kilómetros. Así tenemos NO₂ para ${fmt(n.air_sections)} secciones y ruido para ${fmt(n.noise_sections)}. Son aproximaciones para el área y las zonas sin cobertura siguen sin datos.`,
 ['datos/_etl_/main.py','datos/_etl_/monitoring.py','datos/_etl_/output/coverage_report.json','db/ingest-sections.py','db/migrations/003_section_data.sql']);
}
// 5. Native architecture + two stages.
{
 const s=slide('Búsqueda con Express y Claude',5);
 const ui=node(s,'Interfaz Next.js',70,170,260,75);const api=node(s,'API Express\nTypeScript',510,170,260,75);const db=node(s,'PostgreSQL\nPostGIS',950,170,260,75);
 connect(s,ui,api);connect(s,api,db);
 const p=node(s,'1. Claude interpreta\nrequisitos y preferencias',70,355,350,100);
 const sql=node(s,'Filtros validados\ny SQL parametrizado',475,355,330,100);
 const rank=node(s,'2. Claude valora\nlotes de 300, en paralelo',860,355,350,100);
 connect(s,p,sql);connect(s,sql,rank);
 text(s,'Consultas simples: SQL directo. Preferencias: Claude con datos compactos.',70,283,1110,43,20,colors.muted);
 text(s,'Logs de tokens, coste y latencia',70,493,650,55,20,colors.muted);
 text(s,'Hasta 50 resultados aceptados',860,491,360,58,24,colors.green,true);
 text(s,'Si faltan resultados, se analiza el siguiente lote hasta agotar candidatos o presupuesto.',72,585,1100,57,19,colors.muted);
 note(s,'API y conversación',50,
 'Las consultas sencillas por barrio se resuelven directamente con SQL, sin esperar a Claude. Las viviendas que cumplen todos los filtros reciben cien de cien. Para peticiones más complejas, Claude interpreta criterios y preferencias con datos censales compactos; el backend valida el plan y aplica consultas parametrizadas. Después evalúa lotes de hasta trescientos anuncios en paralelo, devolviendo solo identificadores y puntuaciones. El trabajo del modelo tiene un presupuesto de tiempo: si no termina, se conservan viviendas con filtros verificados y la valoración pendiente se indica sin inventar una puntuación. Los logs registran tokens, coste estimado y duración.',
 ['backend/src/chat.ts','backend/src/claude.ts','backend/src/search.ts','backend/src/log.ts','front-end/src/lib/server/atlas-api.ts']);
}
// 6. Shared result set and routine.
{
 const s=slide('Una selección compartida en toda la aplicación',6);
 const result=node(s,'Resultado de búsqueda\ncon identificador común',465,170,350,100);
 const cards=node(s,'Fichas',70,390,235,82);const map=node(s,'Mapa',370,390,235,82);const csv=node(s,'CSV',670,390,235,82);const chat=node(s,'Conversación',970,390,235,82);
 for(const target of [cards,map,csv,chat])connect(s,result,target,'bottom','top');
 text(s,'Los trayectos diarios pesan más que las visitas ocasionales',74,517,1120,60,24,colors.dark,true);
 text(s,'Los trayectos del MVP son estimaciones de Claude, sin horarios ni conexiones verificados.',74,595,1100,55,18,colors.muted);
 note(s,'Experiencia de uso',35,
 'La selección recibe un identificador común. Las fichas, el mapa y la exportación muestran ese mismo conjunto, y una conversación posterior conserva el contexto. Al pulsar un grupo del mapa aparecen sus anuncios, sin tener que localizar cada punto haciendo zoom. También puede explicar su rutina: ir a clase, visitar a la familia o ver a sus amigos. Durante la búsqueda se oculta el listado anterior y rotan curiosidades reales. Los trayectos diarios pesan más que las visitas ocasionales. Claude estima rutas de las cinco primeras viviendas, usando transporte público por defecto u otro modo solicitado. El chat da un resumen breve: son aproximaciones de IA, sin horarios comprobados.',
 ['backend/src/db.ts','backend/src/chat.ts','front-end/src/stores/conversation-slice.ts','front-end/src/components/map/madrid-map.tsx']);
}
// 7. Honest close.
{
 const s=slide('Un MVP para decidir dónde vivir',7);
 text(s,'Anuncios reales\ncon contexto de la zona',75,190,1110,155,42,colors.green,true);
 text(s,'El valor está en cruzar la vivienda con lo que importa al usuario.',78,379,1090,72,25,colors.dark);
 text(s,'Siguiente paso: contrastar los trayectos con un servicio de rutas y completar las uniones pendientes.',78,511,1100,90,21,colors.muted);
 text(s,facts.integration_status,78,628,1100,30,14,colors.muted);
 note(s,'Cierre',20,
 'Atlas cruza anuncios reales con información del entorno para ayudar a decidir dónde vivir. El siguiente paso es verificar trayectos con un servicio de rutas y completar las uniones pendientes. La base del MVP ya conecta los datos de vivienda y de la ciudad con una interfaz común para explorarlos.',
 ['README.md','backend/README.md','datos/_etl_/output/coverage_report.json']);
}

const buildDir=path.join(here,'.build',revision);
await fs.mkdir(buildDir,{recursive:true});
for (const [i,s] of deck.slides.items.entries()) {
 const png=await deck.export({slide:s,format:'png',scale:1});
 await fs.writeFile(path.join(buildDir,`slide-${i+1}.png`),new Uint8Array(await png.arrayBuffer()));
 const layout=await s.export({format:'layout'});
 await fs.writeFile(path.join(buildDir,`slide-${i+1}.layout.json`),await layout.text());
}
const montage=await deck.export({format:'webp',montage:true});
await fs.writeFile(path.join(buildDir,'montage.webp'),new Uint8Array(await montage.arrayBuffer()));
const candidate=path.join(buildDir,'candidate.pptx');
await (await PresentationFile.exportPptx(deck)).save(candidate);
const result=await finalizePresentation({workspaceDir:root,candidatePath:candidate,finalPath:output,
 pythonExecutable:path.join(runtime,'python/bin/python3'),
 integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),
 layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),
 layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],
 explicitTotalSlideCount:7,materializeLiteralChartWorkbooks:true,requiredNativeChartOwnerSlides:[3,4],fontPolicy:{basis:'design',families:[font]},
 verifyArtifactToolImport:true,receiptPath:path.join(buildDir,'validation.json')});
await fs.writeFile(path.join(here,'pitch-4min.md'),notes.map((x,i)=>`## ${i+1}. ${x.title} (${x.seconds} s)\n\n${x.script}`).join('\n\n')+'\n');
const words=notes.map(x=>x.script).join(' ').split(/\s+/).length;
const finalOutput=path.join(here,'output','Atlas-pitch-4min.pptx');
await fs.copyFile(output,finalOutput);
await fs.writeFile(path.join(here,'deck.json'),JSON.stringify({output:finalOutput,revision_output:output,revision,slides:7,seconds:notes.reduce((a,b)=>a+b.seconds,0),script_words:words,font,notes,validation:result},null,2)+'\n');
console.log(JSON.stringify({output:finalOutput,slides:7,seconds:240,words,font,montage:path.join(buildDir,'montage.webp')}));
