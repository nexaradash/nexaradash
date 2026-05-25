import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@12.18.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature!, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const tenantId = session.client_reference_id
      if (!tenantId) {
        console.error('No client_reference_id on session')
        return new Response('ok', { status: 200 })
      }
      const periodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      await supabase.from('subscriptions').upsert([{
        tenant_id: tenantId,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        stripe_session_id: session.id,
        status: 'trialing',
        price_id: Deno.env.get('STRIPE_PRICE_ID') ?? '',
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      }], { onConflict: 'tenant_id' })
      console.log('Subscription created for tenant:', tenantId)
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string
      const { data: existing } = await supabase
        .from('subscriptions')
        .select('tenant_id')
        .eq('stripe_customer_id', customerId)
        .limit(1)
      if (existing && existing.length) {
        await supabase.from('subscriptions').update({
          status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('stripe_customer_id', customerId)
        console.log('Subscription updated for customer:', customerId, 'status:', sub.status)
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string
      await supabase.from('subscriptions').update({
        status: 'canceled',
        updated_at: new Date().toISOString(),
      }).eq('stripe_customer_id', customerId)
      console.log('Subscription cancelled for customer:', customerId)
    }
  } catch (err) {
    console.error('Webhook handler error:', err.message)
    return new Response(JSON.stringify({ error: 'Handler failed' }), { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
})