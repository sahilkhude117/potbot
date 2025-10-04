import { Hono } from 'hono'

type Bindings = {
  DATABASE_URL: string
  JWT_SECRET: string
}

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => {
  return c.text("Hello hono");
})

export default app
