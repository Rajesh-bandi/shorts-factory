/* Runtime configuration.
 *
 * Same-origin deployments (EC2, local) leave apiBase empty. When the frontend
 * is hosted separately, set it to the API origin (for example
 * "https://api.example.com") so API and media requests include cookies.
 */
window.SHORTS_CONFIG = Object.assign({ apiBase: "" }, window.SHORTS_CONFIG || {});
