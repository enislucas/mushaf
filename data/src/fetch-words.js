// quran.com's own word list per ayah - the timing segments index THESE words,
// so this (not a space-split of the text) is what aligns with the audio.
const fs=require('fs');
(async()=>{
  const out={}; let fails=[];
  const chs=[...Array(114)].map((_,i)=>i+1); let idx=0;
  async function getPage(c,p){
    const r=await fetch(`https://api.quran.com/api/v4/verses/by_chapter/${c}?words=true&word_fields=text_uthmani,char_type_name&per_page=50&page=${p}&fields=text_uthmani`);
    return r.json();
  }
  async function worker(){
    while(idx<chs.length){
      const c=chs[idx++]; const verses=[];
      try{
        let p=1, j;
        do { j=await getPage(c,p); verses.push(...j.verses); p++; } while(j.pagination.next_page);
        out[c]=verses.map(v=>({k:v.verse_key,t:v.text_uthmani,w:v.words.map(w=>[w.position,w.text_uthmani,w.char_type_name])}));
      }catch(e){ fails.push(c+':'+e.message); }
    }
  }
  await Promise.all([...Array(6)].map(worker));
  fs.writeFileSync('words.json',JSON.stringify(out));
  const n=Object.values(out).reduce((s,c)=>s+c.length,0);
  const types={}; for(const c of Object.values(out)) for(const v of c) for(const w of v.w) types[w[2]]=(types[w[2]]||0)+1;
  console.log('chapters:',Object.keys(out).length,'verses:',n,'fails:',fails.join(',')||'none');
  console.log('word types:',JSON.stringify(types));
  console.log('114:1:',JSON.stringify(out[114][0].w));
  console.log('2:2  :',JSON.stringify(out[2][1].w.map(w=>w[1]+'/'+w[2])));
})();
