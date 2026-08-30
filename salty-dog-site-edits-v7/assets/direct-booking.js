(()=>{
const slug=new URLSearchParams(location.search).get("stay"),booking=document.querySelector(".booking");
if(!slug||!booking)return;
const style=document.createElement("style");
style.textContent=`.direct-booking{display:none;border-top:1px solid var(--line);margin-top:20px;padding-top:18px}.direct-booking.active{display:block}.direct-booking h3{margin:0;color:var(--navy);font-size:20px}.direct-booking p{margin:4px 0 12px;color:var(--muted);font-size:13px}.direct-booking label{margin-top:9px}.quote{background:var(--mist);border-radius:11px;padding:12px;margin-top:12px;font-size:14px}.quote strong{float:right;color:var(--navy)}.checkout-error{color:#a83c32!important;min-height:20px}.secure-checkout{width:100%;border:0;cursor:pointer;font:inherit}.secure-checkout:disabled{opacity:.55;cursor:wait}`;
document.head.append(style);
const section=document.createElement("section");
section.className="direct-booking";
section.innerHTML=`<h3>Book direct & save</h3><p>Secure payment through Stripe. Final availability is checked before checkout.</p><label for="bookingEmail">Email</label><input id="bookingEmail" type="email" autocomplete="email" placeholder="you@example.com"><div class="quote" id="directQuote">Choose check-in and checkout dates.</div><button class="book secure-checkout" id="directCheckout" type="button">Continue to secure checkout</button><p class="checkout-error" id="checkoutError" role="alert"></p>`;
booking.querySelector(".note").before(section);
const checkin=document.getElementById("checkin"),checkout=document.getElementById("checkout"),guests=document.getElementById("guests"),email=section.querySelector("#bookingEmail"),quote=section.querySelector("#directQuote"),button=section.querySelector("#directCheckout"),error=section.querySelector("#checkoutError");
let config;
const money=value=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value);
function renderQuote(){
  if(!config||!checkin.value||!checkout.value){quote.textContent="Choose check-in and checkout dates.";return}
  const nights=Math.round((new Date(checkout.value+"T00:00:00Z")-new Date(checkin.value+"T00:00:00Z"))/86400000);
  if(nights<1){quote.textContent="Choose a checkout date after check-in.";return}
  const subtotal=config.nightlyRate*nights+config.cleaningFee,total=subtotal+subtotal*config.taxRate;
  quote.innerHTML=`${nights} night${nights===1?"":"s"}, cleaning & estimated taxes <strong>${money(total)}</strong>`;
}
fetch(`/api/direct-booking/config/${encodeURIComponent(slug)}`).then(r=>r.json()).then(data=>{
  if(!data.enabled)return;
  config=data;section.classList.add("active");
  booking.querySelector("p").textContent="Choose your dates and guests. Book directly here or compare the listing on Airbnb.";
  booking.querySelector(".note").textContent="Direct payments are processed securely by Stripe.";
  renderQuote();
}).catch(()=>{});
[checkin,checkout,guests].forEach(field=>field.addEventListener("change",renderQuote));
button.onclick=async()=>{
  error.textContent="";
  if(!checkin.value||!checkout.value||!email.validity.valid){error.textContent="Choose valid dates and enter your email.";return}
  button.disabled=true;button.textContent="Checking availability…";
  try{
    const response=await fetch("/api/direct-booking/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug,checkin:checkin.value,checkout:checkout.value,guests:Number(guests.value),email:email.value.trim()})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Checkout could not be started.");
    location.href=data.url;
  }catch(err){error.textContent=err.message;button.disabled=false;button.textContent="Continue to secure checkout"}
};
})();
