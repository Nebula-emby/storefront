export const epayGatewayIds = ["saleor.epay.gateway", "app.saleor.epay"] as const;

export type EpayGatewayId = (typeof epayGatewayIds)[number];

export interface EpayGatewayInitializePayload {
	gatewayName?: string;
	supportedPaymentMethods?: string[];
	supportedCurrencies?: string[];
	requiresRedirect?: boolean;
	requestMode?: "mapi" | "submit";
	paymentMethodLabels?: Record<string, string>;
}

export type SupportedEpayMethod = "alipay" | "wxpay" | (string & {});
