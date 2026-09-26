// word-level timings for every surah, Husary muallim (quran.com reciter 12)
const fs=require('fs');
(async()=>{
  const out={}; let fails=[];
  const chs=[...Array(114)].map((_,i)=>i+1); let idx=0;
  async function worker(){
    while(idx<chs.length){
      const c=chs[idx++];
      for(let t=0;t<3;t++){
        try{
          const r=await fetch(`https://api.qurancdn.com/api/qdc/audio/reciters/12/audio_files?chapter=${c}&segments=true`);
          const j=await r.json(); const f=j.audio_files[0];
          out[c]={url:f.audio_url,duration:f.duration,format:f.format,verses:f.verse_timings.map(v=>({k:v.verse_key,from:v.timestamp_from,to:v.timestamp_to,seg:v.segments}))};
          break;
        }catch(e){ if(t===2) fails.push(c); }
      }
    }
  }
  await Promise.all([...Array(6)].map(worker));
  fs.writeFileSync('husary-muallim-timings.json',JSON.stringify(out));
  const n=Object.values(out).reduce((s,c)=>s+c.verses.length,0);
  const noSeg=Object.values(out).flatMap(c=>c.verses).filter(v=>!v.seg||!v.seg.length).length;
  const hours=Object.values(out).reduce((s,c)=>s+c.duration,0)/3600000;
  console.log('chapters:',Object.keys(out).length,'verses:',n,'verses without word segments:',noSeg,'total hours:',hours.toFixed(1),'fails:',fails.join(',')||'none');
  console.log('2:255 words:',out[2].verses[254].seg.length,'from',out[2].verses[254].from,'to',out[2].verses[254].to);
})();
