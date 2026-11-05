/** @type {import('tailwindcss').Config} */
module.exports = {
  // Every folder that holds JSX: a class used only in an unlisted folder is
  // never generated (the moved forecast chart rendered 0 px tall that way)
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/features/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ube: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          500: '#0066cc',
          600: '#0052a3',
          700: '#003e7a',
          800: '#0a2540',
          900: '#061729',
        },
      },
    },
  },
  plugins: [],
};
