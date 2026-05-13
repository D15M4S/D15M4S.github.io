export type SeriesStatus = "planned" | "in-progress" | "completed";

export type SeriesChapter = {
	order: number;
	title: string;
	description?: string;
};

export type SeriesDefinition = {
	slug: string;
	title: string;
	description: string;
	cover?: string;
	coverPosition?: string;
	category?: string;
	tags?: string[];
	status: SeriesStatus;
	totalPosts?: number;
	order?: number;
	chapters?: SeriesChapter[];
};

export const SERIES_PAGE_SIZE = 4;

export const seriesDefinitions: SeriesDefinition[] = [
	{
		slug: "kubernetes-network-deep-dive",
		title: "쿠버네티스 Deep Dive - 네트워크 편",
		description:
			"Linux 네트워크 기초부터 Pod, CNI, Service, DNS, Ingress/Gateway, NetworkPolicy까지 Kubernetes 네트워크의 핵심 흐름을 패킷 관점에서 정리하는 시리즈입니다.",
		cover: "/assets/series/kubernetes-network-deep-dive.png",
		category: "Kubernetes",
		tags: ["Kubernetes", "Network", "CNI", "Service", "DNS"],
		status: "in-progress",
		totalPosts: 8,
		order: 1,
		chapters: [
			{
				order: 1,
				title: "Linux 네트워크 기초",
				description: "network namespace, veth pair, bridge, routing, NAT, conntrack",
			},
			{
				order: 2,
				title: "Kubernetes Network Model과 CNI",
				description: "Pod IP, Pod network, pause container, CNI가 보장해야 하는 것",
			},
			{
				order: 3,
				title: "Pod-to-Pod 통신: 같은 노드와 다른 노드",
				description: "same-node path, cross-node routing, Pod CIDR, overlay/underlay, VXLAN",
			},
			{
				order: 4,
				title: "Service와 EndpointSlice",
				description: "selector, endpoint tracking, ClusterIP, headless Service, Service without selector",
			},
			{
				order: 5,
				title: "kube-proxy와 Virtual IP",
				description: "Service proxy, iptables/IPVS/nftables, DNAT, NodePort, traffic policy",
			},
			{
				order: 6,
				title: "DNS for Services and Pods",
				description: "CoreDNS, Service DNS, Pod DNS, search domain, headless Service DNS",
			},
			{
				order: 7,
				title: "Ingress와 Gateway API: 클러스터 밖에서 들어오는 트래픽",
				description: "NodePort, LoadBalancer, Ingress Controller, GatewayClass, Gateway, HTTPRoute",
			},
			{
				order: 8,
				title: "NetworkPolicy와 네트워크 디버깅",
				description: "ingress/egress policy, CNI enforcement, Debug Services, DNS debugging, CNI troubleshooting",
			},
		],
	},
	{
		slug: "cka-journey",
		title: "CKA 취득 도전기",
		description:
			"CKA를 취득하는 과정에서 추가로 공부하였거나, 확인했던 내용들, 팁 등을 정리했습니다.",
		cover: "/assets/series/cka.png",
		category: "Kubernetes",
		tags: ["CKA", "Kubernetes", "Certification"],
		status: "in-progress",
		order: 2,
	},
];
