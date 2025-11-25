export const profile = {
	fullName: 'Raymond Berger',
	title: '',
	institute: '',
	author_name: 'Raymond Berger', // Author name to be highlighted in the papers section
	research_areas: [
		{ title: 'Physics', description: 'Brief description of the research interest', field: 'physics' },
	],
}

// Set equal to an empty string to hide the icon that you don't want to display
export const social = {
	email: '',
	linkedin: 'https://www.linkedin.com/in/rlberger/',
	x: '',
	github: '',
	gitlab: '',
	scholar: '',
	inspire: '',
	arxiv: '',
	orcid: '',
	bluesky: 'https://bsky.app/profile/rayb.bsky.social',
}

export const template = {
	website_url: 'https://rayberger.org', // Astro needs to know your site’s deployed URL to generate a sitemap. It must start with http:// or https://
	menu_left: false,
	transitions: false, // disabled because they're janky on mobile
	lightTheme: 'winter', // Select one of the Daisy UI Themes or create your own
	darkTheme: 'dark', // Select one of the Daisy UI Themes or create your own
	excerptLength: 200,
	postPerPage: 5,
	base: '' // Repository name starting with /
}

export const seo = {
	default_title: 'Ray Berger',
	default_description: 'Ray Berger is an urbanist based in San Francisco.',
	default_image: '/assets/me.png',
}
