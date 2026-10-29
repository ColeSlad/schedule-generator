import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = worker;
export async function extractAudit(file: File): Promise<string> {
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose a PDF smaller than 15 MB.');
  const document = await getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise;
  try {
    if (document.numPages > 60) throw new Error('This pilot supports audits up to 60 pages.');
    const pages:string[]=[];
    for(let n=1;n<=document.numPages;n++) {
      const page=await document.getPage(n); const content=await page.getTextContent();
      const rows: {y:number; cells:{x:number;text:string}[]}[]=[];
      for(const item of content.items) {
        if(!('str' in item) || !item.str.trim()) continue;
        const y=item.transform[5];
        let row=rows.find(r=>Math.abs(r.y-y)<2);
        if(!row){ row={y,cells:[]}; rows.push(row); }
        row.cells.push({x:item.transform[4],text:item.str});
      }
      pages.push(rows.sort((a,b)=>b.y-a.y).map(r=>r.cells.sort((a,b)=>a.x-b.x).map(c=>c.text).join(' ')).join('\n'));
    }
    const text=pages.join('\n');
    if(text.replace(/\s/g,'').length<200) throw new Error('No readable text found. Export an expanded, printer-friendly PDF from uAchieve. Scanned audits are not supported.');
    return text;
  } finally { await document.destroy(); }
}
