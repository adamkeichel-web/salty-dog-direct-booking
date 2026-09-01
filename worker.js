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

async function storedSettings(env,slug){
  if(!env.BOOKINGS_DB)return {};
  try{
    const row=await env.BOOKINGS_DB.prepare("SELECT settings_json FROM property_settings WHERE slug=?1").bind(slug).first();
    return row?.settings_json?JSON.parse(row.settings_json):{};
  }catch{return {}}
}

async function propertyConfig(env,slug){
  const base=getBookingConfig(env)[slug]||{},stored=await storedSettings(env,slug);
  return {...base,...(stored.pricing||{})};
}

function adminEmail(request,env){
  const email=(request.headers.get("Cf-Access-Authenticated-User-Email")||"").toLowerCase();
  const allowed=String(env.ADMIN_EMAIL||"").toLowerCase().split(",").map(value=>value.trim()).filter(Boolean);
  return email&&allowed.includes(email)?email:null;
}

function cleanSettings(input){
  const text=(value,max=4000)=>String(value??"").replace(/[<>]/g,"").trim().slice(0,max),number=value=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:0};
  const source=input?.content||{},pricing=input?.pricing||{};
  return {content:{
    name:text(source.name,120),destination:text(source.destination,80),type:text(source.type,80),headline:text(source.headline,220),summary:text(source.summary),goodToKnow:text(source.goodToKnow),airbnb:text(source.airbnb,500),
    guests:number(source.guests),bedrooms:number(source.bedrooms),bathrooms:number(source.bathrooms),
    highlights:(Array.isArray(source.highlights)?source.highlights:[]).map(value=>text(value,160)).filter(Boolean).slice(0,30),
    tags:(Array.isArray(source.tags)?source.tags:[]).map(value=>text(value,60).toLowerCase()).filter(Boolean).slice(0,30),
    photoOrder:(Array.isArray(source.photoOrder)?source.photoOrder:[]).map(Number).filter(value=>Number.isInteger(value)&&value>0&&value<=40).slice(0,40)
  },pricing:{
    nightlyRate:number(pricing.nightlyRate),weekendRate:number(pricing.weekendRate),cleaningFee:number(pricing.cleaningFee),taxRate:Math.min(number(pricing.taxRate),1),petFee:number(pricing.petFee),maxPets:Math.min(Math.floor(number(pricing.maxPets)),10),minimumNights:Math.max(1,Math.min(Math.floor(number(pricing.minimumNights)),30)),
    otherFees:(Array.isArray(pricing.otherFees)?pricing.otherFees:[]).map(fee=>({name:text(fee?.name,80),amount:number(fee?.amount)})).filter(fee=>fee.name).slice(0,20),
    seasonalRates:(Array.isArray(pricing.seasonalRates)?pricing.seasonalRates:[]).map(rate=>({name:text(rate?.name,80),start:text(rate?.start,10),end:text(rate?.end,10),nightlyRate:number(rate?.nightlyRate),weekendRate:number(rate?.weekendRate)})).filter(rate=>/^\d{4}-\d{2}-\d{2}$/.test(rate.start)&&/^\d{4}-\d{2}-\d{2}$/.test(rate.end)&&rate.end>rate.start&&rate.nightlyRate>0).slice(0,40)
  }};
}

async function publicProperty(request,env,slug){
  const assetUrl=new URL(`/properties/${slug}.json`,request.url),response=await env.ASSETS.fetch(new Request(assetUrl,request));
  if(!response.ok)return json({error:"Property not found"},404);
  const base=await response.json(),stored=await storedSettings(env,slug);
  return json({...base,...(stored.content||{})});
}

function otherFees(property){
  if(!Array.isArray(property?.otherFees))return [];
  return property.otherFees.map(fee=>({
    name:String(fee?.name||"Other fee").trim().slice(0,80),
    amount:Number(fee?.amount||0)
  })).filter(fee=>fee.name&&Number.isFinite(fee.amount)&&fee.amount>0);
}

function seasonalRates(property){
  if(!Array.isArray(property?.seasonalRates))return [];
  return property.seasonalRates.map(rate=>({
    name:String(rate?.name||"Seasonal rate").trim().slice(0,80),
    start:String(rate?.start||""),end:String(rate?.end||""),
    nightlyRate:Number(rate?.nightlyRate||0),weekendRate:Number(rate?.weekendRate||0)
  })).filter(rate=>/^\d{4}-\d{2}-\d{2}$/.test(rate.start)&&/^\d{4}-\d{2}-\d{2}$/.test(rate.end)&&rate.end>rate.start&&rate.nightlyRate>0);
}

function lodgingBreakdown(property,start,nights){
  const groups=new Map(),seasons=seasonalRates(property),base=Number(property.nightlyRate),baseWeekend=Number(property.weekendRate||0);
  for(let offset=0;offset<nights;offset++){
    const date=new Date(start);date.setUTCDate(date.getUTCDate()+offset);
    const iso=date.toISOString().slice(0,10),weekend=date.getUTCDay()===5||date.getUTCDay()===6,season=seasons.find(rate=>iso>=rate.start&&iso<rate.end);
    const rate=season?(weekend&&season.weekendRate>0?season.weekendRate:season.nightlyRate):(weekend&&baseWeekend>0?baseWeekend:base);
    const name=season?.name||"Nightly lodging",cents=Math.round(rate*100),key=`${name}|${cents}`;
    const current=groups.get(key)||{name,amountCents:cents,quantity:0};current.quantity++;groups.set(key,current);
  }
  return [...groups.values()];
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

function hex(bytes){return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,"0")).join("")}

function safeEqual(a,b){
  if(a.length!==b.length)return false;
  let result=0;
  for(let i=0;i<a.length;i++)result|=a.charCodeAt(i)^b.charCodeAt(i);
  return result===0;
}

async function validStripeSignature(payload,header,secret){
  if(!header||!secret)return false;
  const parts=header.split(",").map(part=>part.split("="));
  const timestamp=parts.find(([key])=>key==="t")?.[1];
  const signatures=parts.filter(([key])=>key==="v1").map(([,value])=>value);
  if(!timestamp||!signatures.length||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${timestamp}.${payload}`)));
  return signatures.some(candidate=>safeEqual(signature,candidate));
}

function requireDatabase(env){
  if(!env.BOOKINGS_DB)throw new Error("Booking database is not configured");
  return env.BOOKINGS_DB;
}

async function directRanges(env,slug){
  if(!env.BOOKINGS_DB)return [];
  const result=await env.BOOKINGS_DB.prepare(`
    SELECT checkin AS start, checkout AS end FROM bookings
    WHERE property_slug = ?1 AND (status = 'paid' OR (status = 'pending' AND julianday(expires_at) > julianday('now')))
    ORDER BY checkin
  `).bind(slug).all();
  return result.results||[];
}

function icalDate(value){return String(value).replaceAll("-","")}

function directIcal(slug,ranges,origin){
  const events=ranges.map(range=>[
    "BEGIN:VEVENT",`UID:${range.id}@${new URL(origin).hostname}`,`DTSTART;VALUE=DATE:${icalDate(range.start)}`,
    `DTEND;VALUE=DATE:${icalDate(range.end)}`,"SUMMARY:Reserved","STATUS:CONFIRMED","END:VEVENT"
  ].join("\r\n")).join("\r\n");
  return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Salty Dog & Co.//Direct Bookings//EN",`X-WR-CALNAME:${slug} direct bookings`,events,"END:VCALENDAR",""] .join("\r\n");
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
    if((url.pathname==="/admin"||url.pathname==="/admin.html")&&!adminEmail(request,env))return new Response("Property Editor is locked. Configure Cloudflare Access and ADMIN_EMAIL to continue.",{status:403,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
    if(url.pathname==="/admin"&&adminEmail(request,env))return env.ASSETS.fetch(new Request(new URL("/admin.html",url),request));
    if(url.pathname.startsWith("/api/properties/")&&request.method==="GET"){
      const slug=decodeURIComponent(url.pathname.slice("/api/properties/".length));
      if(!allowedProperties.has(slug))return json({error:"Property not found"},404);
      return publicProperty(request,env,slug);
    }
    if(url.pathname.startsWith("/api/admin/properties/")){
      if(!adminEmail(request,env))return json({error:"Unauthorized"},401);
      if(!env.BOOKINGS_DB)return json({error:"Database unavailable"},503);
      await env.BOOKINGS_DB.prepare("CREATE TABLE IF NOT EXISTS property_settings (slug TEXT PRIMARY KEY,settings_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT (datetime('now')),updated_by TEXT)").run();
      const slug=decodeURIComponent(url.pathname.slice("/api/admin/properties/".length));
      if(!allowedProperties.has(slug))return json({error:"Property not found"},404);
      if(request.method==="GET"){
        const stored=await storedSettings(env,slug);
        return json({settings:{...stored,pricing:{...await propertyConfig(env,slug),...(stored.pricing||{})}}});
      }
      if(request.method==="PUT"){
        let settings;try{settings=cleanSettings(await request.json())}catch{return json({error:"Invalid settings"},400)}
        const serialized=JSON.stringify(settings);if(serialized.length>50000)return json({error:"Settings are too large"},400);
        await env.BOOKINGS_DB.prepare("INSERT INTO property_settings (slug,settings_json,updated_at,updated_by) VALUES (?1,?2,datetime('now'),?3) ON CONFLICT(slug) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by").bind(slug,serialized,adminEmail(request,env)).run();
        return json({saved:true});
      }
      return json({error:"Method not allowed"},405);
    }
    if(url.pathname==="/api/stripe/webhook"&&request.method==="POST"){
      const payload=await request.text();
      if(!await validStripeSignature(payload,request.headers.get("Stripe-Signature"),env.STRIPE_WEBHOOK_SECRET))return json({error:"Invalid signature"},400);
      let event;
      try{event=JSON.parse(payload)}catch{return json({error:"Invalid payload"},400)}
      const session=event.data?.object,bookingId=session?.metadata?.booking_id;
      if(bookingId&&env.BOOKINGS_DB){
        if(event.type==="checkout.session.completed"&&session.payment_status==="paid"){
          await env.BOOKINGS_DB.prepare(`UPDATE bookings SET status='paid', paid_at=datetime('now'), amount_total=?1, currency=?2 WHERE id=?3 AND status='pending'`).bind(session.amount_total||0,session.currency||"usd",bookingId).run();
        }else if(event.type==="checkout.session.expired"){
          await env.BOOKINGS_DB.prepare(`UPDATE bookings SET status='expired' WHERE id=?1 AND status='pending'`).bind(bookingId).run();
        }
      }
      return json({received:true});
    }
    if(url.pathname.startsWith("/api/calendar/direct/")&&url.pathname.endsWith(".ics")){
      const slug=decodeURIComponent(url.pathname.slice("/api/calendar/direct/".length,-4));
      if(!allowedProperties.has(slug))return new Response("Not found",{status:404});
      const db=requireDatabase(env);
      const result=await db.prepare(`SELECT id, checkin AS start, checkout AS end FROM bookings WHERE property_slug=?1 AND status='paid' ORDER BY checkin`).bind(slug).all();
      return new Response(directIcal(slug,result.results||[],url.origin),{headers:{"Content-Type":"text/calendar; charset=utf-8","Cache-Control":"no-store"}});
    }
    if(url.pathname.startsWith("/api/direct-booking/config/")){
      const slug=decodeURIComponent(url.pathname.slice("/api/direct-booking/config/".length));
      if(!allowedProperties.has(slug))return json({error:"Property not found"},404);
      const property=await propertyConfig(env,slug);
      const enabled=Boolean(env.STRIPE_SECRET_KEY&&property?.enabled&&property?.nightlyRate);
      return json({
        enabled,
        nightlyRate:enabled?property.nightlyRate:null,
        weekendRate:enabled?(property.weekendRate||null):null,
        seasonalRates:enabled?seasonalRates(property):[],
        cleaningFee:enabled?(property.cleaningFee||0):null,
        otherFees:enabled?otherFees(property):[],
        petFee:enabled?(property.petFee||0):null,
        maxPets:enabled?(property.maxPets||0):null,
        minimumNights:enabled?(property.minimumNights||1):null,
        taxRate:enabled?(property.taxRate||0):null,
        showCalendarPricing:enabled&&property.showCalendarPricing===true,
        currency:"usd"
      });
    }
    if(url.pathname==="/api/direct-booking/checkout"&&request.method==="POST"){
      if(!env.STRIPE_SECRET_KEY)return json({error:"Direct booking is not active yet."},503);
      let db;
      try{db=requireDatabase(env)}catch{return json({error:"The booking database is not active yet."},503)}
      const origin=request.headers.get("Origin");
      if(origin&&origin!==url.origin)return json({error:"Invalid request origin."},403);
      let input;
      try{input=await request.json()}catch{return json({error:"Invalid booking request."},400)}
      const {slug,checkin,checkout,guests,email}=input||{};const petCount=Number(input?.pets||0);
      if(!allowedProperties.has(slug))return json({error:"Property not found."},404);
      const property=await propertyConfig(env,slug);
      if(!property?.enabled||!property?.nightlyRate)return json({error:"Direct booking is not active for this property yet."},503);
      const start=dateValue(checkin),end=dateValue(checkout),guestCount=Number(guests);
      const today=new Date();today.setUTCHours(0,0,0,0);
      const nights=start&&end?nightsBetween(start,end):0;
      const minimumNights=Math.max(1,Number(property.minimumNights||1));
      if(!start||!end||start<today||nights<minimumNights||nights>30)return json({error:`Choose valid dates between ${minimumNights} and 30 nights.`},400);
      if(!Number.isInteger(guestCount)||guestCount<1||guestCount>Number(property.maxGuests||30))return json({error:"Choose a valid guest count."},400);
      if(!Number.isInteger(petCount)||petCount<0||petCount>Number(property.maxPets||0))return json({error:"Choose a valid number of pets."},400);
      if(!/^\S+@\S+\.\S+$/.test(email||""))return json({error:"Enter a valid email address."},400);
      try{
        if(overlaps(await unavailableRanges(env,slug),start,end))return json({error:"Those dates are no longer available. Please choose different dates."},409);
      }catch{return json({error:"We could not confirm availability. Please try again shortly."},503)}
      const lodging=lodgingBreakdown(property,start,nights);
      const cleaning=Math.round(Number(property.cleaningFee||0)*100);
      const pets=Math.round(Number(property.petFee||0)*100)*petCount;
      const fees=otherFees(property).map(fee=>({...fee,amountCents:Math.round(fee.amount*100)}));
      const otherFeesTotal=fees.reduce((sum,fee)=>sum+fee.amountCents,0);
      const lodgingTotal=lodging.reduce((sum,item)=>sum+item.amountCents*item.quantity,0);
      const subtotal=lodgingTotal+cleaning+pets+otherFeesTotal;
      const tax=Math.round(subtotal*Number(property.taxRate||0));
      const total=subtotal+tax;
      if(!Number.isSafeInteger(total)||total<50)return json({error:"This quote could not be calculated."},500);
      const bookingId=crypto.randomUUID(),expiresAt=new Date(Date.now()+30*60*1000).toISOString();
      const hold=await db.prepare(`
        INSERT INTO bookings (id,property_slug,checkin,checkout,guests,email,status,expires_at)
        SELECT ?1,?2,?3,?4,?5,?6,'pending',?7
        WHERE NOT EXISTS (
          SELECT 1 FROM bookings WHERE property_slug=?2 AND checkout>?3 AND checkin<?4
          AND (status='paid' OR (status='pending' AND julianday(expires_at)>julianday('now')))
        )
      `).bind(bookingId,slug,checkin,checkout,guestCount,email,expiresAt).run();
      if(!hold.meta?.changes)return json({error:"Those dates are being reserved by another guest. Please choose different dates."},409);
      const success=`${url.origin}/booking-success?session_id={CHECKOUT_SESSION_ID}`;
      const cancel=`${url.origin}/property.html?stay=${encodeURIComponent(slug)}&checkin=${checkin}&checkout=${checkout}&guests=${guestCount}`;
      const lineItems=lodging.map(item=>({name:`${property.name||slug} · ${item.name}`,description:`${checkin} to ${checkout} · ${guestCount} guest${guestCount===1?"":"s"}`,amount:item.amountCents,quantity:item.quantity}));
      if(cleaning>0)lineItems.push({name:"Cleaning fee",amount:cleaning,quantity:1});
      if(pets>0)lineItems.push({name:`Pet fee · ${petCount} pet${petCount===1?"":"s"}`,amount:pets,quantity:1});
      for(const fee of fees)lineItems.push({name:fee.name,amount:fee.amountCents,quantity:1});
      if(tax>0)lineItems.push({name:"Estimated taxes",amount:tax,quantity:1});
      const stripeValues={
        mode:"payment",success_url:success,cancel_url:cancel,customer_email:email,
        "metadata[booking_id]":bookingId,"metadata[property]":slug,"metadata[checkin]":checkin,"metadata[checkout]":checkout,"metadata[guests]":guestCount,"metadata[pets]":petCount
      };
      lineItems.forEach((item,index)=>{
        stripeValues[`line_items[${index}][price_data][currency]`]="usd";
        stripeValues[`line_items[${index}][price_data][product_data][name]`]=item.name;
        if(item.description)stripeValues[`line_items[${index}][price_data][product_data][description]`]=item.description;
        stripeValues[`line_items[${index}][price_data][unit_amount]`]=item.amount;
        stripeValues[`line_items[${index}][quantity]`]=item.quantity;
      });
      const stripe=await fetch("https://api.stripe.com/v1/checkout/sessions",{
        method:"POST",
        headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,"Content-Type":"application/x-www-form-urlencoded"},
        body:formEncode(stripeValues)
      });
      const session=await stripe.json();
      if(!stripe.ok||!session.url){await db.prepare("UPDATE bookings SET status='expired' WHERE id=?1").bind(bookingId).run();return json({error:"Secure checkout could not be started. Please try again."},502)}
      await db.prepare("UPDATE bookings SET stripe_session_id=?1 WHERE id=?2").bind(session.id,bookingId).run();
      return json({url:session.url});
    }
    if(url.pathname.startsWith("/api/calendar/")){
      const slug=decodeURIComponent(url.pathname.slice("/api/calendar/".length));
      let feeds={};
      try{feeds=JSON.parse(env.ICAL_FEEDS||"{}")}catch{}
      const feed=feeds[slug];
      if(!feed)return json({error:"Calendar unavailable"},503);
      const cache=caches.default,cached=env.BOOKINGS_DB?null:await cache.match(request);
      if(cached)return cached;
      try{
        const upstream=await fetch(feed,{headers:{"User-Agent":"Salty-Dog-Calendar/1.0"}});
        if(!upstream.ok)throw new Error("Airbnb calendar request failed");
        const body={ranges:[...parseIcal(await upstream.text()),...await directRanges(env,slug)],updatedAt:new Date().toISOString()};
        const response=Response.json(body,{headers:{"Cache-Control":env.BOOKINGS_DB?"public, max-age=30":"public, max-age=900","X-Content-Type-Options":"nosniff"}});
        if(!env.BOOKINGS_DB)ctx.waitUntil(cache.put(request,response.clone()));
        return response;
      }catch{
        return Response.json({error:"Calendar temporarily unavailable"},{status:502,headers:{"Cache-Control":"no-store"}});
      }
    }
    return env.ASSETS.fetch(request);
  }
};
