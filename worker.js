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

const allowedProperties=new Set([
  "beachfront-bliss","deep-blue-dive","sea-turtle","seaside-vibes",
  "stars-and-sea","the-salty-dog","waterfront-paradise"
]);

function json(data,status=200){
  return Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}

function getBookingConfig(env){
  try{return JSON.parse(env.DIRECT_BOOKING_CONFIG||"{}")}catch{return {}}
}

function dateValue(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||""))return null;
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf())?null:date;
}

function nightsBetween(start,end){
  return Math.round((end-start)/86400000);
}

function formEncode(values){
  const body=new URLSearchParams();
  for(const [key,value] of Object.entries(values))body.set(key,String(value));
  return body;
}

async function unavailableRanges(env,slug){
  let feeds={};
  try{feeds=JSON.parse(env.ICAL_FEEDS||"{}")}catch{}
  if(!feeds[slug])return [];
  const upstream=await fetch(feeds[slug],{headers:{"User-Agent":"Salty-Dog-Calendar/1.0"}});
  if(!upstream.ok)throw new Error("Calendar request failed");
  return parseIcal(await upstream.text());
}

function overlaps(ranges,start,end){
  const from=start.toISOString().slice(0,10),to=end.toISOString().slice(0,10);
  return ranges.some(range=>from<range.end&&to>range.start);
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname.startsWith("/api/direct-booking/config/")){
      const slug=decodeURIComponent(url.pathname.slice("/api/direct-booking/config/".length));
      if(!allowedProperties.has(slug))return json({error:"Property not found"},404);
      const property=getBookingConfig(env)[slug];
      const enabled=Boolean(env.STRIPE_SECRET_KEY&&property?.enabled&&property?.nightlyRate);
      return json({
        enabled,
        nightlyRate:enabled?property.nightlyRate:null,
        cleaningFee:enabled?(property.cleaningFee||0):null,
        taxRate:enabled?(property.taxRate||0):null,
        currency:"usd"
      });
    }
    if(url.pathname==="/api/direct-booking/checkout"&&request.method==="POST"){
      if(!env.STRIPE_SECRET_KEY)return json({error:"Direct booking is not active yet."},503);
      const origin=request.headers.get("Origin");
      if(origin&&origin!==url.origin)return json({error:"Invalid request origin."},403);
      let input;
      try{input=await request.json()}catch{return json({error:"Invalid booking request."},400)}
      const {slug,checkin,checkout,guests,email}=input||{};
      if(!allowedProperties.has(slug))return json({error:"Property not found."},404);
      const property=getBookingConfig(env)[slug];
      if(!property?.enabled||!property?.nightlyRate)return json({error:"Direct booking is not active for this property yet."},503);
      const start=dateValue(checkin),end=dateValue(checkout),guestCount=Number(guests);
      const today=new Date();today.setUTCHours(0,0,0,0);
      const nights=start&&end?nightsBetween(start,end):0;
      if(!start||!end||start<today||nights<1||nights>30)return json({error:"Choose valid dates between 1 and 30 nights."},400);
      if(!Number.isInteger(guestCount)||guestCount<1||guestCount>Number(property.maxGuests||30))return json({error:"Choose a valid guest count."},400);
      if(!/^\S+@\S+\.\S+$/.test(email||""))return json({error:"Enter a valid email address."},400);
      try{
        if(overlaps(await unavailableRanges(env,slug),start,end))return json({error:"Those dates are no longer available. Please choose different dates."},409);
      }catch{return json({error:"We could not confirm availability. Please try again shortly."},503)}
      const nightly=Math.round(Number(property.nightlyRate)*100);
      const cleaning=Math.round(Number(property.cleaningFee||0)*100);
      const subtotal=nightly*nights+cleaning;
      const tax=Math.round(subtotal*Number(property.taxRate||0));
      const total=subtotal+tax;
      if(!Number.isSafeInteger(total)||total<50)return json({error:"This quote could not be calculated."},500);
      const success=`${url.origin}/booking-success?session_id={CHECKOUT_SESSION_ID}`;
      const cancel=`${url.origin}/property.html?stay=${encodeURIComponent(slug)}&checkin=${checkin}&checkout=${checkout}&guests=${guestCount}`;
      const stripe=await fetch("https://api.stripe.com/v1/checkout/sessions",{
        method:"POST",
        headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,"Content-Type":"application/x-www-form-urlencoded"},
        body:formEncode({
          mode:"payment",success_url:success,cancel_url:cancel,customer_email:email,
          "line_items[0][price_data][currency]":"usd",
          "line_items[0][price_data][product_data][name]":`${property.name||slug} · ${nights} night${nights===1?"":"s"}`,
          "line_items[0][price_data][product_data][description]":`${checkin} to ${checkout} · ${guestCount} guest${guestCount===1?"":"s"}`,
          "line_items[0][price_data][unit_amount]":total,
          "line_items[0][quantity]":1,
          "metadata[property]":slug,"metadata[checkin]":checkin,"metadata[checkout]":checkout,"metadata[guests]":guestCount
        })
      });
      const session=await stripe.json();
      if(!stripe.ok||!session.url)return json({error:"Secure checkout could not be started. Please try again."},502);
      return json({url:session.url});
    }
    if(url.pathname.startsWith("/api/calendar/")){
      const slug=decodeURIComponent(url.pathname.slice("/api/calendar/".length));
      let feeds={};
      try{feeds=JSON.parse(env.ICAL_FEEDS||"{}")}catch{}
      const feed=feeds[slug];
      if(!feed)return json({error:"Calendar unavailable"},503);
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
