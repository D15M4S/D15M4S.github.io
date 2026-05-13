import { type CollectionEntry, getCollection } from "astro:content";
import {
	type SeriesDefinition,
	type SeriesStatus,
	seriesDefinitions,
} from "@constants/series";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { getCategoryUrl, getSeriesUrl } from "@utils/url-utils.ts";

// // Retrieve posts and sort them by publication date
async function getRawSortedPosts() {
	const allBlogPosts = await getCollection("posts", ({ data }) => {
		return data.draft !== true;
	});

	const sorted = allBlogPosts.sort((a, b) => {
		const dateA = new Date(a.data.published);
		const dateB = new Date(b.data.published);
		return dateA > dateB ? -1 : 1;
	});
	return sorted;
}

export async function getSortedPosts() {
	const sorted = await getRawSortedPosts();

	for (let i = 1; i < sorted.length; i++) {
		sorted[i].data.nextSlug = sorted[i - 1].slug;
		sorted[i].data.nextTitle = sorted[i - 1].data.title;
	}
	for (let i = 0; i < sorted.length - 1; i++) {
		sorted[i].data.prevSlug = sorted[i + 1].slug;
		sorted[i].data.prevTitle = sorted[i + 1].data.title;
	}

	return sorted;
}
export type PostForList = {
	slug: string;
	data: CollectionEntry<"posts">["data"];
};
export async function getSortedPostsList(): Promise<PostForList[]> {
	const sortedFullPosts = await getRawSortedPosts();

	// delete post.body
	const sortedPostsList = sortedFullPosts.map((post) => ({
		slug: post.slug,
		data: post.data,
	}));

	return sortedPostsList;
}
export type Tag = {
	name: string;
	count: number;
};

export async function getTagList(): Promise<Tag[]> {
	const allBlogPosts = await getCollection<"posts">("posts", ({ data }) => {
		return data.draft !== true;
	});

	const countMap: { [key: string]: number } = {};
	allBlogPosts.map((post: { data: { tags: string[] } }) => {
		post.data.tags.map((tag: string) => {
			if (!countMap[tag]) countMap[tag] = 0;
			countMap[tag]++;
		});
	});

	// sort tags
	const keys: string[] = Object.keys(countMap).sort((a, b) => {
		return a.toLowerCase().localeCompare(b.toLowerCase());
	});

	return keys.map((key) => ({ name: key, count: countMap[key] }));
}

export type Category = {
	name: string;
	count: number;
	url: string;
};

export async function getCategoryList(): Promise<Category[]> {
	const allBlogPosts = await getCollection<"posts">("posts", ({ data }) => {
		return data.draft !== true;
	});
	const count: { [key: string]: number } = {};
	allBlogPosts.map((post: { data: { category: string | null } }) => {
		if (!post.data.category) {
			const ucKey = i18n(I18nKey.uncategorized);
			count[ucKey] = count[ucKey] ? count[ucKey] + 1 : 1;
			return;
		}

		const categoryName =
			typeof post.data.category === "string"
				? post.data.category.trim()
				: String(post.data.category).trim();

		count[categoryName] = count[categoryName] ? count[categoryName] + 1 : 1;
	});

	const lst = Object.keys(count).sort((a, b) => {
		return a.toLowerCase().localeCompare(b.toLowerCase());
	});

	const ret: Category[] = [];
	for (const c of lst) {
		ret.push({
			name: c,
			count: count[c],
			url: getCategoryUrl(c),
		});
	}
	return ret;
}

export type SeriesOverview = SeriesDefinition & {
	postCount: number;
	totalPosts: number;
	posts: PostForList[];
	latestPost?: PostForList;
	url: string;
};

function sortPostsBySeriesOrder(posts: PostForList[]): PostForList[] {
	return [...posts].sort((a, b) => {
		const orderA = a.data.seriesOrder ?? Number.MAX_SAFE_INTEGER;
		const orderB = b.data.seriesOrder ?? Number.MAX_SAFE_INTEGER;
		if (orderA !== orderB) return orderA - orderB;
		return a.data.published.getTime() - b.data.published.getTime();
	});
}

function getLatestPost(posts: PostForList[]): PostForList | undefined {
	return [...posts].sort(
		(a, b) => b.data.published.getTime() - a.data.published.getTime(),
	)[0];
}

function inferStatus(
	definition: SeriesDefinition | undefined,
	postCount: number,
	totalPosts: number,
): SeriesStatus {
	if (definition?.status) return definition.status;
	if (postCount === 0) return "planned";
	if (totalPosts > 0 && postCount >= totalPosts) return "completed";
	return "in-progress";
}

export async function getSeriesList(): Promise<SeriesOverview[]> {
	const posts = await getSortedPostsList();
	const groupedPosts = new Map<string, PostForList[]>();

	for (const post of posts) {
		const series = post.data.series?.trim();
		if (!series) continue;
		groupedPosts.set(series, [...(groupedPosts.get(series) ?? []), post]);
	}

	const definedSeries = seriesDefinitions.map((definition) => {
		const seriesPosts = sortPostsBySeriesOrder(
			groupedPosts.get(definition.slug) ?? [],
		);
		const totalPosts =
			definition.totalPosts ?? definition.chapters?.length ?? seriesPosts.length;
		return {
			...definition,
			status: inferStatus(definition, seriesPosts.length, totalPosts),
			totalPosts,
			postCount: seriesPosts.length,
			posts: seriesPosts,
			latestPost: getLatestPost(seriesPosts),
			url: getSeriesUrl(definition.slug),
		};
	});

	const definedSlugs = new Set(seriesDefinitions.map((series) => series.slug));
	const inferredSeries = [...groupedPosts.entries()]
		.filter(([slug]) => !definedSlugs.has(slug))
		.map(([slug, seriesPosts]) => {
			const sortedPosts = sortPostsBySeriesOrder(seriesPosts);
			const firstPost = sortedPosts[0];
			const title = firstPost?.data.seriesTitle || slug;
			const description =
				firstPost?.data.seriesDescription ||
				firstPost?.data.description ||
				`${title} 시리즈입니다.`;
			const definition: SeriesDefinition = {
				slug,
				title,
				description,
				category: firstPost?.data.category ?? undefined,
				status: "in-progress",
				totalPosts: sortedPosts.length,
				order: Number.MAX_SAFE_INTEGER,
			};
			return {
				...definition,
				postCount: sortedPosts.length,
				totalPosts: sortedPosts.length,
				posts: sortedPosts,
				latestPost: getLatestPost(sortedPosts),
				url: getSeriesUrl(slug),
			};
		});

	return [...definedSeries, ...inferredSeries].sort((a, b) => {
		const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
		const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
		if (orderA !== orderB) return orderA - orderB;
		return a.title.localeCompare(b.title);
	});
}

export async function getSeriesBySlug(
	slug: string,
): Promise<SeriesOverview | undefined> {
	const seriesList = await getSeriesList();
	return seriesList.find((series) => series.slug === slug);
}
