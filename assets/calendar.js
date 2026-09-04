(()=>{
const slug=new URLSearchParams(location.search).get("stay");
if(!slug)return;
const style=document.createElement("style");
style.textContent=`
.availability-wrap{width:min(1120px,92%);margin:34px auto 0}.availability-card{background:#fff;border:1px solid var(--line);border-radius:20px;padding:27px;box-shadow:0 10px 30px #173f5510}.calendar-head{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-bottom:20px}.calendar-head h2{margin:0;color:var(--navy);font-size:28px}.calendar-nav{display:flex;gap:8px}.calendar-nav button{width:44px;height:44px;border:1px solid var(--line);border-radius:50%;background:#fff;color:var(--navy);font-size:22px;cursor:pointer}.calendar-months{display:grid;grid-template-columns:1fr 1fr;gap:22px}.month-title{text-align:center;color:var(--navy);font-weight:900;margin-bottom:12px}.week,.days{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}.week span{text-align:center;color:var(--muted);font-size:11px;font-weight:850}.day{aspect-ratio:1;border:0;border-radius:9px;background:var(--mist);color:var(--navy);font-weight:800;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.05}.day-price{display:block;margin-top:4px;font-size:10px;font-weight:750;color:var(--sea)}.day:hover:not(:disabled){outline:2px solid var(--sea)}.day.empty{visibility:hidden}.day.past{background:repeating-linear-gradient(135deg,#f0f2f3,#f0f2f3 5px,#e2e6e8 5px,#e2e6e8 8px);color:#98a2a7;cursor:not-allowed}.day.blocked{background:#e1e7e9;color:#7f8d93;cursor:not-allowed;text-decoration:line-through}.day.selected{background:var(--navy);color:#fff}.day.selected .day-price{color:#fff}.day.range{background:#d8eeea}.calendar-legend{display:flex;gap:18px;flex-wrap:wrap;margin-top:18px;color:var(--muted);font-size:13px}.legend-dot{display:inline-block;width:12px;height:12px;border-radius:4px;margin-right:6px;vertical-align:-1px}.calendar-status{color:var(--muted);font-size:14px}.calendar-note{margin:16px 0 0;color:var(--muted);font-size:12px}@media(max-width:760px){.calendar-months{grid-template-columns:1fr}.calendar-month:nth-child(2){display:none}.availability-card{padding:20px}.calendar-head{align-items:flex-start}.day{border-radius:7px}.day-price{font-size:9px}}
`;
document.head.append(style);
const mount=document.createElement("section");
mount.className="availability-wrap";
mount.innerHTML=`<div class="availability-card"><div class="calendar-head"><div><div class="eyebrow" style="color:var(--sea)">Combined calendar</div><h2>Visual availability</h2><div class="calendar-status" id="calendarStatus">Loading current availability…</div></div><div class="calendar-nav"><button id="calendarPrev" aria-label="Previous month">‹</button><button id="calendarNext" aria-label="Next month">›</button></div></div><div class="calendar-months" id="calendarMonths"></div><div class="calendar-legend"><span><i class="legend-dot" style="background:var(--mist)"></i>Available</span><span><i class="legend-dot" style="background:#e1e7e9;border:1px solid #cfd8dc"></i>Booked or blocked</span><span><i class="legend-dot" style="background:repeating-linear-gradient(135deg,#f0f2f3,#f0f2f3 3px,#dfe4e6 3px,#dfe4e6 5px)"></i>Past date</span><span><i class="legend-dot" style="background:var(--navy)"></i>Selected</span></div><p class="calendar-note">Availability combines Airbnb reservations with direct booking holds. Airbnb imports may take several hours to reflect changes.</p></div>`;
document.querySelector(".gallery").after(mount);
const months=mount.querySelector("#calendarMonths"),status=mount.querySelector("#calendarStatus"),checkin=document.getElementById("checkin"),checkout=document.getElementById("checkout");
let ranges=[],pricing=null,cursor=new Date(),selectedStart=checkin.value||"",selectedEnd=checkout.value||"";
cursor=new Date(cursor.getFullYear(),cursor.getMonth(),1);
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const blocked=date=>ranges.some(r=>date>=r.start&&date<r.end);
function rateForDate(value){
  if(!pricing)return null;
  const seasons=Array.isArray(pricing.seasonalRates)?pricing.seasonalRates:[],season=seasons.find(rate=>value>=rate.start&&value<rate.end),date=new Date(`${value}T00:00:00Z`),weekend=date.getUTCDay()===5||date.getUTCDay()===6;
  const rate=season?(weekend&&Number(season.weekendRate)>0?season.weekendRate:season.nightlyRate):(weekend&&Number(pricing.weekendRate)>0?pricing.weekendRate:pricing.nightlyRate);
  return Number(rate)>0?Number(rate):null;
}
function renderMonth(base){
  const year=base.getFullYear(),month=base.getMonth(),first=new Date(year,month,1),last=new Date(year,month+1,0),today=iso(new Date());
  let html=`<div class="calendar-month"><div class="month-title">${base.toLocaleDateString(undefined,{month:"long",year:"numeric"})}</div><div class="week">${["S","M","T","W","T","F","S"].map(x=>`<span>${x}</span>`).join("")}</div><div class="days">`;
  for(let i=0;i<first.getDay();i++)html+=`<button class="day empty" tabindex="-1"></button>`;
  for(let day=1;day<=last.getDate();day++){
    const value=iso(new Date(year,month,day)),isPast=value<today,isBlocked=blocked(value),selected=value===selectedStart||value===selectedEnd,inRange=selectedStart&&selectedEnd&&value>selectedStart&&value<selectedEnd;
    const cls=["day",isPast?"past":"",isBlocked?"blocked":"",selected?"selected":"",inRange?"range":""].filter(Boolean).join(" ");
    const nightlyRate=rateForDate(value),price=!isPast&&!isBlocked&&nightlyRate?`<small class="day-price">$${Math.round(nightlyRate)}</small>`:"",availabilityLabel=isBlocked?", unavailable":nightlyRate?`, available at $${Math.round(nightlyRate)} per night`:", available";
    html+=`<button class="${cls}" data-date="${value}" ${isPast||isBlocked?"disabled":""} aria-label="${value}${availabilityLabel}"><span>${day}</span>${price}</button>`;
  }
  return html+"</div></div>";
}
function render(){
  const second=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);
  months.innerHTML=renderMonth(cursor)+renderMonth(second);
}
months.onclick=e=>{
  const button=e.target.closest("[data-date]");if(!button)return;
  const value=button.dataset.date;
  if(!selectedStart||selectedEnd||value<=selectedStart){selectedStart=value;selectedEnd="";checkin.value=value;checkout.value=""}
  else{
    let invalid=false,d=new Date(selectedStart+"T12:00:00");
    while(iso(d)<value){if(blocked(iso(d))){invalid=true;break}d.setDate(d.getDate()+1)}
    if(invalid){selectedStart=value;selectedEnd="";checkin.value=value;checkout.value=""}
    else{selectedEnd=value;checkout.value=value}
  }
  checkin.dispatchEvent(new Event("change",{bubbles:true}));checkout.dispatchEvent(new Event("change",{bubbles:true}));render();
};
mount.querySelector("#calendarPrev").onclick=()=>{const next=new Date(cursor.getFullYear(),cursor.getMonth()-1,1),now=new Date();if(next>=new Date(now.getFullYear(),now.getMonth(),1)){cursor=next;render()}};
mount.querySelector("#calendarNext").onclick=()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);render()};
fetch(`/api/direct-booking/config/${encodeURIComponent(slug)}`).then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{pricing=data.showCalendarPricing?data:null;if(pricing)status.textContent="Available dates show the current direct-booking nightly rate.";render()}).catch(()=>{});
fetch(`/api/calendar/${encodeURIComponent(slug)}`).then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{ranges=data.ranges||[];status.textContent=pricing?"Available dates show the current direct-booking nightly rate.":"";render()}).catch(()=>{status.textContent="Live calendar is temporarily unavailable. Please try again shortly.";render()});
render();
})();
