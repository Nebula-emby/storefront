import { useEffect, useMemo, useRef, useState } from "react";
import { type CountryCode, usePaymentGatewaysInitializeMutation } from "@/checkout/graphql";
import { useCheckout } from "@/checkout/hooks/useCheckout";
import { useSubmit } from "@/checkout/hooks/useSubmit";
import { type MightNotExist } from "@/checkout/lib/globalTypes";
import { type ParsedPaymentGateways, type PaymentGatewayId } from "@/checkout/sections/PaymentSection/types";
import { getFilteredPaymentGateways } from "@/checkout/sections/PaymentSection/utils";

const DEFAULT_METHOD_LABELS: Record<string, string> = {
	alipay: "支付宝",
	wxpay: "微信支付",
	qqpay: "QQ 支付",
	crypto: "加密货币",
};

export const usePaymentGatewaysInitialize = () => {
	const {
		checkout: { billingAddress },
	} = useCheckout();
	const {
		checkout: { id: checkoutId, availablePaymentGateways },
	} = useCheckout();

	const billingCountry = billingAddress?.country.code as MightNotExist<CountryCode>;

	const [gatewayConfigs, setGatewayConfigs] = useState<ParsedPaymentGateways>([]);
	const previousBillingCountry = useRef(billingCountry);

	const [{ fetching }, paymentGatewaysInitialize] = usePaymentGatewaysInitializeMutation();

	const onSubmit = useSubmit<{}, typeof paymentGatewaysInitialize>(
		useMemo(
			() => ({
				hideAlerts: true,
				scope: "paymentGatewaysInitialize",
				shouldAbort: () => !availablePaymentGateways.length,
				onSubmit: paymentGatewaysInitialize,
				parse: () => ({
					checkoutId,
					paymentGateways: getFilteredPaymentGateways(availablePaymentGateways).map(({ config, id }) => ({
						id,
						data: config,
					})),
				}),
				onSuccess: ({ data }) => {
					const filteredGateways = getFilteredPaymentGateways(availablePaymentGateways);
					const rawConfigs = data.gatewayConfigs ?? [];

					const parsedConfigs = filteredGateways.map((gateway) => {
						const remoteConfig = rawConfigs.find(
							(config) =>
								config?.id === gateway.id && config?.data && !(config.errors && config.errors.length),
						);

						if (remoteConfig?.data) {
							const dataObject = remoteConfig.data as Record<string, unknown>;
							if (!dataObject.requestMode) {
								dataObject.requestMode = "mapi";
							}
							const supported = Array.isArray(dataObject.supportedPaymentMethods)
								? (dataObject.supportedPaymentMethods as string[])
								: [];
							if (!dataObject.paymentMethodLabels || typeof dataObject.paymentMethodLabels !== "object") {
								dataObject.paymentMethodLabels = supported.reduce<Record<string, string>>((acc, method) => {
									acc[method] = DEFAULT_METHOD_LABELS[method] ?? method;
									return acc;
								}, {});
							} else {
								const labels = dataObject.paymentMethodLabels as Record<string, string>;
								supported.forEach((method) => {
									if (!labels[method]) {
										labels[method] = DEFAULT_METHOD_LABELS[method] ?? method;
									}
								});
							}
							return {
								id: remoteConfig.id as PaymentGatewayId,
								data: dataObject,
								errors: remoteConfig.errors ?? [],
							};
						}

						const fallbackEntries = (gateway.config ?? []).filter(
							(entry): entry is NonNullable<(typeof gateway.config)[number]> => Boolean(entry?.field),
						);

						const fallbackData = fallbackEntries.reduce<Record<string, unknown>>((acc, entry) => {
							if (entry?.field) {
								acc[entry.field] = entry.value;
							}
							return acc;
						}, {});

						if (!fallbackData.supportedPaymentMethods) {
							fallbackData.supportedPaymentMethods =
								gateway.config
									?.filter(
										(entry) => entry?.field === "supportedPaymentMethods" && Array.isArray(entry.value),
									)
									.flatMap((entry) => entry?.value as string[]) ?? [];
						}

						if (!fallbackData.supportedCurrencies) {
							fallbackData.supportedCurrencies =
								gateway.config
									?.filter((entry) => entry?.field === "supportedCurrencies" && Array.isArray(entry.value))
									.flatMap((entry) => entry?.value as string[]) ?? [];
						}

						fallbackData.supportedCurrencies = (fallbackData.supportedCurrencies as string[]).map(
							(currency) => currency.toUpperCase(),
						);

						const requestModeEntry = fallbackEntries.find((entry) => entry.field === "requestMode");
						if (!fallbackData.requestMode && requestModeEntry && typeof requestModeEntry.value === "string") {
							const normalized = requestModeEntry.value.toLowerCase();
							fallbackData.requestMode = normalized === "submit" ? "submit" : "mapi";
						}

						if (!fallbackData.requestMode) {
							fallbackData.requestMode = "mapi";
						}

						if (
							!fallbackData.supportedPaymentMethods ||
							!(fallbackData.supportedPaymentMethods as string[]).length
						) {
							fallbackData.supportedPaymentMethods = ["alipay", "wxpay"];
						}

						const labelsFromConfig = fallbackEntries
							.filter(
								(entry) =>
									entry.field === "paymentMethodLabels" && entry.value && typeof entry.value === "object",
							)
							.reduce<Record<string, string>>((acc, entry) => {
								Object.entries(entry.value as Record<string, string>).forEach(([key, val]) => {
									if (typeof val === "string") {
										acc[key] = val;
									}
								});
								return acc;
							}, {});

						if (!fallbackData.paymentMethodLabels || typeof fallbackData.paymentMethodLabels !== "object") {
							fallbackData.paymentMethodLabels = { ...DEFAULT_METHOD_LABELS, ...labelsFromConfig };
						}

						const supported = fallbackData.supportedPaymentMethods as string[];
						const fallbackLabels = fallbackData.paymentMethodLabels as Record<string, string>;
						supported.forEach((method) => {
							if (!fallbackLabels[method]) {
								fallbackLabels[method] = DEFAULT_METHOD_LABELS[method] ?? method;
							}
						});

						if (gateway.id === "saleor.epay.gateway" || gateway.id === "app.saleor.epay") {
							fallbackData.gatewayName ??= gateway.name ?? "Epay";
							fallbackData.supportedPaymentMethods ??= ["alipay", "wxpay"];
							fallbackData.requiresRedirect ??= true;
							fallbackData.requestMode ??= "mapi";
						}

						return {
							id: gateway.id as PaymentGatewayId,
							data: fallbackData,
							errors: [],
						};
					}) as ParsedPaymentGateways;

					if (!parsedConfigs.length) {
						throw new Error("No available payment gateways");
					}

					setGatewayConfigs(parsedConfigs);
				},
				onError: ({ errors }) => {
					console.log({ errors });
				},
			}),
			[availablePaymentGateways, checkoutId, paymentGatewaysInitialize],
		),
	);

	useEffect(() => {
		void onSubmit();
	}, [onSubmit]);

	useEffect(() => {
		if (billingCountry !== previousBillingCountry.current) {
			previousBillingCountry.current = billingCountry;
			void onSubmit();
		}
	}, [billingCountry, onSubmit]);

	return {
		fetching,
		availablePaymentGateways: gatewayConfigs || [],
	};
};
