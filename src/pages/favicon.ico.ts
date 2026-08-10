export const prerender = false;

export const GET = () =>
  new Response(null, {
    status: 204,
    headers: {
      "cache-control": "public, max-age=86400",
    },
  });
