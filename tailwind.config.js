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
            },
            keyframes: {
                slideIn: {
                    '0%': { opacity: '0', transform: 'translateX(100%) scale(0.95)' },
                    '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
                },
            },
            animation: {
                slideIn: 'slideIn 0.2s ease-out',
            },
        },
    },
    plugins: [],
}
