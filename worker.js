function parseDate(value){
  const m=value.match(/^(\d{4})(\d{2})(\d{2})/);
  return m?`${m[1]}-${m[2]}-${m[3]}`:null;
}

function parseIcal(text){
  const lines=text.replace(/\r\n[ \t]/g,"").split(/\r?\n/);
  const ranges=[];
  let start=null,end=null,inEvent=false;
  for(const line of lines){
    if(line==="BEGIN:VEVENT"){inEvent=true;start=end=null;continue}
    if(line==="END:VEVENT"){
      if(inEvent&&start&&end)ranges.push({start,end});
      inEvent=false;continue;
    }
    if(!inEvent)continue;
    const split=line.indexOf(":");
    if(split<0)continue;
    const key=line.slice(0,split).split(";")[0],value=line.slice(split+1);
    if(key==="DTSTART")start=parseDate(value);
    if(key==="DTEND")end=parseDate(value);
  }
  return ranges;
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname.startsWith("/api/calendar/")){
      const slug=decodeURIComponent(url.pathname.slice("/api/calendar/".length));
      let feeds={};
      try{feeds=JSON.parse(env.ICAL_FEEDS||"{}")}catch{}
      const feed=feeds[slug];
      if(!feed)return Response.json({error:"Calendar unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});
      const cache=caches.default,cached=await cache.match(request);
      if(cached)return cached;
      try{
        const upstream=await fetch(feed,{headers:{"User-Agent":"Salty-Dog-Calendar/1.0"}});
        if(!upstream.ok)throw new Error("Airbnb calendar request failed");
        const body={ranges:parseIcal(await upstream.text()),updatedAt:new Date().toISOString()};
        const response=Response.json(body,{headers:{"Cache-Control":"public, max-age=900","X-Content-Type-Options":"nosniff"}});
        ctx.waitUntil(cache.put(request,response.clone()));
        return response;
      }catch{
        return Response.json({error:"Calendar temporarily unavailable"},{status:502,headers:{"Cache-Control":"no-store"}});
      }
    }
    return env.ASSETS.fetch(request);
  }
};
