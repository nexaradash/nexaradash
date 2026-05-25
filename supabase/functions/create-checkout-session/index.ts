import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@11.1.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

serve(async (req) => {
  const corsHeaders={
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  }
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const{priceId,tenantId}=await req.json()
    const session=await stripe.checkout.sessions.create({
      mode:'subscription',
      line_items:[{price:priceId,quantity:1}],
      success_url:`https://nexaradash.com/app?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`https://nexaradash.com/app?stripe_cancel=1`,
      client_reference_id:tenantId,
      subscription_data:{trial_period_days:7},
    })
    return new Response(JSON.stringify({url:session.url}),{
      headers:{...corsHeaders,'Content-Type':'application/json'},
      status:200,
    })
  }catch(e){
    return new Response(JSON.stringify({error:e.message}),{
      headers:{...corsHeaders,'Content-Type':'application/json'},
      status:500,
    })
  }
})