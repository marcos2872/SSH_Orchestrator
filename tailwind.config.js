/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "#0f172a",
                foreground: "#f8fafc",
                primary: "#3b82f6",
                secondary: "#1e293b",
            }
        },
    },
    plugins: [],
}
