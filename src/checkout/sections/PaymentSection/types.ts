import { type DummyGatewayId } from "./DummyDropIn/types";
import { type EpayGatewayId, type EpayGatewayInitializePayload } from "./Epay/types";
import { type StripeGatewayId } from "./StripeElements/types";
import { type PaymentGatewayConfig } from "@/checkout/graphql";
import {
	type AdyenGatewayId,
	type AdyenGatewayInitializePayload,
} from "@/checkout/sections/PaymentSection/AdyenDropIn/types";

export type PaymentGatewayId = AdyenGatewayId | StripeGatewayId | DummyGatewayId | EpayGatewayId;

export type ParsedAdyenGateway = ParsedPaymentGateway<AdyenGatewayId, AdyenGatewayInitializePayload>;
export type ParsedStripeGateway = ParsedPaymentGateway<StripeGatewayId, {}>;
export type ParsedDummyGateway = ParsedPaymentGateway<DummyGatewayId, {}>;
export type ParsedEpayGateway = ParsedPaymentGateway<EpayGatewayId, EpayGatewayInitializePayload>;

export type ParsedPaymentGateways = ReadonlyArray<
	ParsedAdyenGateway | ParsedStripeGateway | ParsedDummyGateway | ParsedEpayGateway
>;

export interface ParsedPaymentGateway<ID extends string, TData extends Record<string, any>>
	extends Omit<PaymentGatewayConfig, "data" | "id"> {
	data: TData;
	id: ID;
}

export type PaymentStatus = "paidInFull" | "overpaid" | "none" | "authorized";
