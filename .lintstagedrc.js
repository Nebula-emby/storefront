// https://nextjs.org/docs/basic-features/eslint#lint-staged

import path from "path";

const buildEslintCommand = (filenames) => {
	const files = filenames
		.filter((file) => !path.basename(file).startsWith("."))
		.map((file) => path.relative(process.cwd(), file));

	if (!files.length) {
		return 'echo "No ESLint-eligible files"';
	}

	return `next lint --fix --file ${files.join(" --file ")}`;
};

export default {
	"*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}": [buildEslintCommand],
	"*.*": "prettier --write --ignore-unknown",
};
