/* Runtime configuration.
 *
 * The frontend is hosted on Vercel while the API, media and database stay on
 * EC2, so apiBase points at the EC2 origin. Change it to
 * "https://api.<domain>" when the custom domain is live. Local/self-hosted
 * same-origin builds can leave it empty.
 */
window.SHORTS_CONFIG = Object.assign({ apiBase: "https://shorts.52.207.181.21.sslip.io" }, window.SHORTS_CONFIG || {});
