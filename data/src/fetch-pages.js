// first verse of each of the 604 Madani pages, from quran.com
const fs=require('fs');
(async()=>{
  const out={};
  const pages=[...Array(604)].map((_,i)=>i+1);
  let idx=0, fails=[];
  async function worker(){
    while(idx<pages.length){
      const p=pages[idx++];
      for(let t=0;t<3;t++){
        try{
          const r=await fetch(`https://api.quran.com/api/v4/verses/by_page/${p}?per_page=1&fields=verse_key`);
          const j=await r.json();
          out[p]=j.verses[0].verse_key; break;
        }catch(e){ if(t===2) fails.push(p); }
      }
    }
  }
  await Promise.all([...Array(8)].map(worker));
  fs.writeFileSync('pages.json',JSON.stringify(out));
  console.log('pages:',Object.keys(out).length,'fails:',fails.join(',')||'none','| p1',out[1],'p2',out[2],'p582',out[582],'p604',out[604]);
})();
