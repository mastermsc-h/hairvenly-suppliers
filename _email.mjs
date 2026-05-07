import fs from 'fs';
const env=fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2];return a;},{});
async function g(q,v){const r=await fetch(`https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/2025-01/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':env.SHOPIFY_ACCESS_TOKEN},body:JSON.stringify({query:q,variables:v})});return r.json();}

// Test 1: email accessible on order's customer field?
const r=await g(`query{orders(first:3,query:"financial_status:refunded",sortKey:UPDATED_AT,reverse:true){edges{node{name customer{id email firstName lastName}}}}}`,{});
console.log('Test 1 — order.customer.email:');
console.log(JSON.stringify(r,null,2).slice(0,800));
