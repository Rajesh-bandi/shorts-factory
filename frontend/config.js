/* Runtime configuration.
 *
 * Same-origin deployments (EC2, local) leave apiBase empty. When the frontend
 * is hosted separately, set it to the API origin (for example
 * "https://api.example.com") so API and media requests include cookies.
 */
window.SHORTS_CONFIG = Object.assign({ apiBase: "https://shorts.52.207.181.21.sslip.io" }, window.SHORTS_CONFIG || {});
