import type { Env } from './types';
import { Scheduler } from './modules/scheduler';

/**
 * Cloudflare Worker Entry Point
 * Handles HTTP requests and cron triggers
 */
export default {
  /**
   * Scheduled event handler (Cron Trigger)
   * Runs automatically according to the cron schedule in wrangler.toml
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduledEvent(event, env));
  },

  /**
   * HTTP request handler
   * Supports manual triggering via HTTP with TRIGGER_TOKEN authentication
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === 'OPTIONS') {
        return handleOptionsRequest();
      }

      // Health check — no auth required
      if (path === '/health' || path === '/') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            timestamp: new Date().toISOString(),
            message: 'Bing Wallpaper Uploader Worker is running'
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          }
        );
      }

      // Manual trigger: Upload today's wallpaper (POST only, auth required)
      if (path === '/upload') {
        return await handleUploadRequest(request, env);
      }

      // Manual trigger: Upload multiple days (POST only, auth required)
      if (path === '/upload/multi') {
        return await handleMultiUploadRequest(request, env);
      }

      // Manual trigger: Upload specific date (POST only, auth required)
      if (path === '/upload/date') {
        return await handleSpecificDateRequest(request, env);
      }

      // 404 for unknown paths
      return new Response(
        JSON.stringify({
          error: 'Not Found',
          availableEndpoints: [
            { path: '/', description: 'Health check' },
            { path: '/health', description: 'Health check' },
            { path: '/upload', description: 'POST - Upload today wallpaper (auth required)' },
            { path: '/upload/multi', description: 'POST - Upload last N days wallpapers (auth required)' },
            { path: '/upload/date', description: 'POST - Upload wallpaper from N days ago (auth required)' }
          ]
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    } catch (error) {
      console.error('Error handling request:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : String(error)
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }
  }
};

/**
 * Verify the TRIGGER_TOKEN from the request's Authorization header
 * Returns null if token is valid, or a Response if authentication fails
 */
function verifyToken(request: Request, env: Env): Response | null {
  const expectedToken = env.TRIGGER_TOKEN;

  // If no TRIGGER_TOKEN is configured, reject all authenticated endpoints
  if (!expectedToken) {
    return new Response(
      JSON.stringify({
        error: 'Authentication required',
        message: 'Server configuration is incomplete. Please contact the administrator.'
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      }
    );
  }

  // Extract token from Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({
        error: 'Authentication required',
        message: 'A valid Authorization header is required.'
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      }
    );
  }

  // Support both "Bearer <token>" and "<token>" formats
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (token !== expectedToken) {
    return new Response(
      JSON.stringify({
        error: 'Forbidden',
        message: 'Invalid TRIGGER_TOKEN'
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      }
    );
  }

  return null; // Token is valid
}

/**
 * Handle scheduled cron event
 */
async function handleScheduledEvent(event: ScheduledEvent, env: Env): Promise<void> {
  const scheduler = new Scheduler(env);

  console.log(`[Scheduled] Cron triggered at ${new Date().toISOString()}`);

  try {
    await scheduler.initDb();
    const result = await scheduler.runDailyUpload();

    if (result.skipped) {
      console.log(`[Scheduled] Already uploaded today, skipped.`);
    } else if (result.success) {
      console.log(`[Scheduled] Upload successful: ${result.imageUrl}`);
    } else {
      console.error(`[Scheduled] Upload failed: ${result.error}`);
    }
  } catch (error) {
    console.error(`[Scheduled] Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Handle manual upload request (POST /upload)
 */
async function handleUploadRequest(request: Request, env: Env): Promise<Response> {
  // Method check
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed. Use POST.' }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      }
    );
  }

  // Authenticate
  const authError = verifyToken(request, env);
  if (authError) return authError;

  const scheduler = new Scheduler(env);
  await scheduler.initDb();
  const result = await scheduler.runDailyUpload();

  const statusCode = result.success ? 200 : 500;

  return new Response(
    JSON.stringify({
      success: result.success,
      skipped: result.skipped || false,
      timestamp: new Date().toISOString(),
      imageUrl: result.imageUrl,
      error: result.error
    }),
    {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
}

/**
 * Handle multi-day upload request (POST /upload/multi)
 * Body: { "days": 7 }
 */
async function handleMultiUploadRequest(request: Request, env: Env): Promise<Response> {
  // Method check
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed. Use POST.' }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      }
    );
  }

  // Authenticate
  const authError = verifyToken(request, env);
  if (authError) return authError;

  // Parse days from JSON body (with fallback to query param for backward compat)
  let days = 7;
  try {
    const body = await request.json() as { days?: number };
    if (body.days !== undefined) {
      days = body.days;
    }
  } catch {
    // If JSON parsing fails, try query parameter as fallback
    const url = new URL(request.url);
    const queryDays = url.searchParams.get('days');
    if (queryDays) {
      days = Number(queryDays);
    }
  }

  if (!Number.isInteger(days) || days < 1 || days > 8) {
    return new Response(
      JSON.stringify({
        error: 'Invalid days parameter. Must be between 1 and 8.'
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }

  const scheduler = new Scheduler(env);
  await scheduler.initDb();
  const result = await scheduler.runMultiDayUpload(days);

  const statusCode = result.success ? 200 : 500;

  return new Response(
    JSON.stringify({
      success: result.success,
      timestamp: new Date().toISOString(),
      days,
      results: result.results
    }),
    {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
}

/**
 * Handle specific date upload request (POST /upload/date)
 * Body: { "daysAgo": 1 }
 */
async function handleSpecificDateRequest(request: Request, env: Env): Promise<Response> {
  // Method check
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed. Use POST.' }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      }
    );
  }

  // Authenticate
  const authError = verifyToken(request, env);
  if (authError) return authError;

  // Parse daysAgo from JSON body (with fallback to query param for backward compat)
  let daysAgo = 0;
  try {
    const body = await request.json() as { daysAgo?: number };
    if (body.daysAgo !== undefined) {
      daysAgo = body.daysAgo;
    }
  } catch {
    // If JSON parsing fails, try query parameter as fallback
    const url = new URL(request.url);
    const queryDaysAgo = url.searchParams.get('daysAgo');
    if (queryDaysAgo) {
      daysAgo = Number(queryDaysAgo);
    }
  }

  if (!Number.isInteger(daysAgo) || daysAgo < 0 || daysAgo > 7) {
    return new Response(
      JSON.stringify({
        error: 'Invalid daysAgo parameter. Must be between 0 and 7.'
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }

  const scheduler = new Scheduler(env);
  await scheduler.initDb();
  const result = await scheduler.runSpecificDateUpload(daysAgo);

  const statusCode = result.success ? 200 : 500;

  return new Response(
    JSON.stringify({
      success: result.success,
      skipped: result.skipped || false,
      timestamp: new Date().toISOString(),
      daysAgo,
      imageUrl: result.imageUrl,
      error: result.error
    }),
    {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
}

/**
 * CORS preflight handler — only allows OPTIONS on non-auth endpoints.
 */
function handleOptionsRequest(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}
