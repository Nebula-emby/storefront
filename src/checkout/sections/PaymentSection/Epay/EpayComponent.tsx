"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { type SupportedEpayMethod } from "./types";
import { Button } from "@/checkout/components";
import { apiErrorMessages } from "@/checkout/sections/PaymentSection/errorMessages";
import { getUrlForTransactionInitialize } from "@/checkout/sections/PaymentSection/utils";
import { useTransactionInitializeMutation } from "@/checkout/graphql";
import { useAlerts } from "@/checkout/hooks/useAlerts";
import { useCheckout } from "@/checkout/hooks/useCheckout";
import { useCheckoutComplete } from "@/checkout/hooks/useCheckoutComplete";
import { useErrorMessages } from "@/checkout/hooks/useErrorMessages";
import { usePaymentProcessingScreen } from "@/checkout/sections/PaymentSection/PaymentProcessingScreen";
import { clearQueryParams, getQueryParams, replaceUrl } from "@/checkout/lib/utils/url";
import { type ParsedEpayGateway } from "@/checkout/sections/PaymentSection/types";

const DEFAULT_METHOD_LABELS: Record<string, string> = {
	alipay: "支付宝",
	wxpay: "微信支付",
	qqpay: "QQ 支付",
	crypto: "加密货币",
};

export const EpayComponent = ({ config }: { config: ParsedEpayGateway }) => {
	const [{ fetching: initializingPayment }, transactionInitialize] = useTransactionInitializeMutation();
	const { checkout } = useCheckout();
	const { showCustomErrors, showSuccess } = useAlerts();
	const { errorMessages: commonErrorMessages } = useErrorMessages(apiErrorMessages);
	const { setIsProcessingPayment } = usePaymentProcessingScreen();
	const { onCheckoutComplete } = useCheckoutComplete();

	const [isSubmitting, setIsSubmitting] = useState(false);
	const [qrLink, setQrLink] = useState<string | null>(null);
	const [infoMessage, setInfoMessage] = useState<string | null>(null);
	const [qrImage, setQrImage] = useState<string | null>(null);
	const requestMode = config.data?.requestMode ?? "mapi";

	const methodLabels = useMemo(() => {
		const map: Record<string, string> = { ...DEFAULT_METHOD_LABELS };
		const incoming = config.data?.paymentMethodLabels;
		if (incoming) {
			Object.entries(incoming).forEach(([key, value]) => {
				map[key] = value;
			});
		}
		return map;
	}, [config.data?.paymentMethodLabels]);

	const getMethodLabel = useCallback((method: string) => methodLabels[method] ?? method, [methodLabels]);

	const supportedCurrencies = useMemo(
		() => (config.data?.supportedCurrencies ?? []).map((currency) => currency.toUpperCase()),
		[config.data?.supportedCurrencies],
	);

	const checkoutCurrency = useMemo(
		() => checkout.totalPrice?.gross.currency?.toUpperCase(),
		[checkout.totalPrice?.gross.currency],
	);
	const checkoutAmount = checkout.totalPrice?.gross.amount;

	const currencySupported = useMemo(
		() => !checkoutCurrency || supportedCurrencies.includes(checkoutCurrency),
		[checkoutCurrency, supportedCurrencies],
	);

	const currencyWarning = useMemo(() => {
		if (currencySupported || !checkoutCurrency) {
			return null;
		}

		if (supportedCurrencies.length) {
			return `当前订单币种 ${checkoutCurrency} 暂未在该支付网关启用，仅支持 ${supportedCurrencies.join(
				" / ",
			)}。请更换其他支付方式或联系管理员。`;
		}

		return `当前订单币种 ${checkoutCurrency} 暂未在该支付网关启用，请更换其他支付方式或联系管理员。`;
	}, [currencySupported, checkoutCurrency, supportedCurrencies]);

	useEffect(() => {
		let active = true;

		if (!qrLink) {
			setQrImage(null);
			return () => {
				active = false;
			};
		}

		QRCode.toDataURL(qrLink, { margin: 1, width: 240 })
			.then((url) => {
				if (active) {
					setQrImage(url);
				}
			})
			.catch((error) => {
				console.error("Failed to generate Epay QR code", error);
				if (active) {
					setQrImage(null);
				}
			});

		return () => {
			active = false;
		};
	}, [qrLink]);
	const completionTriggeredRef = useRef(false);
	const statusNotifiedRef = useRef(false);

	const availableMethods = useMemo<SupportedEpayMethod[]>(() => {
		const methods = config.data?.supportedPaymentMethods?.filter(
			(method): method is SupportedEpayMethod => typeof method === "string",
		);
		if (methods?.length) {
			return Array.from(new Set(methods));
		}
		return ["alipay", "wxpay"];
	}, [config.data?.supportedPaymentMethods]);

	const [selectedMethod, setSelectedMethod] = useState<SupportedEpayMethod>(availableMethods[0]);

	useEffect(() => {
		setSelectedMethod((current) => (availableMethods.includes(current) ? current : availableMethods[0]));
	}, [availableMethods]);

	const handleCopyQrLink = useCallback(async () => {
		if (!qrLink) {
			return;
		}

		if (!navigator.clipboard) {
			showCustomErrors([{ message: "当前浏览器不支持复制，请手动复制二维码链接。" }]);
			return;
		}

		try {
			await navigator.clipboard.writeText(qrLink);
			showSuccess("已复制二维码链接到剪贴板");
		} catch (error) {
			console.error("Failed to copy Epay QR link", error);
			showCustomErrors([{ message: "复制失败，请手动复制二维码链接。" }]);
		}
	}, [qrLink, showCustomErrors, showSuccess]);

	const finalizeCheckout = useCallback(() => {
		if (completionTriggeredRef.current) {
			return;
		}

		completionTriggeredRef.current = true;
		setIsProcessingPayment(true);
		replaceUrl({
			query: {
				transaction: undefined,
				trade_status: undefined,
				processingPayment: true,
			},
		});

		void onCheckoutComplete().then((result) => {
			const hasErrors = result?.hasErrors ?? false;
			const apiErrors = result?.apiErrors ?? [];

			if (hasErrors || apiErrors.length) {
				const fallbackErrors =
					apiErrors.length > 0
						? apiErrors.map(({ message }) => ({ message }))
						: [{ message: commonErrorMessages.somethingWentWrong }];
				showCustomErrors(fallbackErrors);
				setIsProcessingPayment(false);
				completionTriggeredRef.current = false;
				clearQueryParams("transaction", "processingPayment", "trade_status");
			}
		});
	}, [commonErrorMessages.somethingWentWrong, onCheckoutComplete, setIsProcessingPayment, showCustomErrors]);

	useEffect(() => {
		const { processingPayment, transaction } = getQueryParams();
		const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
		const tradeStatus = searchParams?.get("trade_status");
		const waitingForPayment = typeof processingPayment === "string" || processingPayment === true;

		if (waitingForPayment && transaction && !completionTriggeredRef.current) {
			finalizeCheckout();
		}

		if (waitingForPayment && tradeStatus && !statusNotifiedRef.current && tradeStatus !== "TRADE_SUCCESS") {
			statusNotifiedRef.current = true;
			showCustomErrors([
				{
					message: `支付返回状态：${tradeStatus}。如果已完成付款，请稍后刷新或在订单中心查看状态。`,
				},
			]);
		}

		if (!waitingForPayment) {
			setIsProcessingPayment(false);
			completionTriggeredRef.current = false;
			statusNotifiedRef.current = false;
		}
	}, [finalizeCheckout, setIsProcessingPayment, showCustomErrors]);

	const handlePayment = useCallback(async () => {
		let redirecting = false;

		clearQueryParams("transaction", "processingPayment");

		setIsSubmitting(true);
		setQrLink(null);
		setInfoMessage(null);

		try {
			const methodDisplayName = getMethodLabel(selectedMethod);
			const amount = checkoutAmount;
			const idempotencyKey =
				typeof crypto !== "undefined" && "randomUUID" in crypto
					? crypto.randomUUID()
					: `${Date.now()}-${Math.random().toString(16).slice(2)}`;

			const response = await transactionInitialize({
				checkoutId: checkout.id,
				amount,
				idempotencyKey,
				paymentGateway: {
					id: config.id,
					data: {
						paymentMethod: selectedMethod,
						returnUrl: getUrlForTransactionInitialize().newUrl,
						orderName: `Saleor Checkout ${checkout.id.slice(-6)}`,
					},
				},
			});

			const payload = response.data?.transactionInitialize;
			const errors = payload?.errors ?? [];

			if (errors.length) {
				showCustomErrors(errors.map(({ message, code }) => ({ message: message ?? code ?? "" })));
				return;
			}

			const transactionId = payload?.transaction?.id;
			const transactionActions = payload?.transaction?.actions ?? [];
			const transactionEventType = payload?.transactionEvent?.type;
			const transactionEventMessage = payload?.transactionEvent?.message;
			const data = (payload?.data ?? {}) as Record<string, unknown>;
			const responseRequestMode =
				typeof data.requestMode === "string" ? data.requestMode.toLowerCase() : undefined;
			const redirectUrl = [data.payurl, data.urlscheme, data.redirectUrl, data.externalUrl].find(
				(value): value is string => typeof value === "string" && value.length > 0,
			);

			if (redirectUrl) {
				redirecting = true;
				replaceUrl({
					query: {
						transaction: transactionId,
						processingPayment: true,
					},
				});
				setIsProcessingPayment(true);
				window.location.href = redirectUrl;
				return;
			}

			if (typeof data.qrcode === "string" && data.qrcode.length > 0) {
				setQrLink(data.qrcode);
				setInfoMessage(`请使用 ${methodDisplayName} 扫描或打开下方链接完成支付。`);
				return;
			}

			if (responseRequestMode === "submit" && typeof data.submitFormHtml === "string") {
				try {
					const parser = new DOMParser();
					const parsed = parser.parseFromString(String(data.submitFormHtml), "text/html");
					const parsedForm = parsed.querySelector("form");

					if (!parsedForm) {
						throw new Error("Missing form element in submit payload.");
					}

					const submitForm = document.importNode(parsedForm, true);
					submitForm.target = "_blank";
					submitForm.rel = "noopener noreferrer";
					submitForm.style.position = "absolute";
					submitForm.style.left = "-9999px";
					submitForm.style.width = "1px";
					submitForm.style.height = "1px";

					document.body.appendChild(submitForm);
					submitForm.submit();
					setTimeout(() => submitForm.remove(), 1000);

					if (transactionId) {
						replaceUrl({
							query: {
								transaction: transactionId,
								processingPayment: true,
							},
						});
					}
					setIsProcessingPayment(true);
					setInfoMessage(`已在新窗口打开 ${methodDisplayName} 支付页面，请按照指引完成支付。`);
				} catch (error) {
					console.error("Failed to submit external payment form", error);
					showCustomErrors([{ message: "创建跳转支付请求失败，请稍后重试或使用其他支付方式。" }]);
				}
				return;
			}

			if (transactionEventType === "CHARGE_SUCCESS" || transactionEventType === "AUTHORIZATION_SUCCESS") {
				if (transactionEventMessage) {
					showSuccess(transactionEventMessage);
				}
				finalizeCheckout();
				return;
			}

			if (transactionEventType && transactionEventType.endsWith("_FAILURE")) {
				const message = transactionEventMessage || "支付请求未成功，请稍后重试或尝试其他支付方式。";
				showCustomErrors([{ message }]);
				replaceUrl({
					query: {
						transaction: undefined,
						processingPayment: undefined,
					},
				});
				setIsProcessingPayment(false);
				return;
			}

			if (transactionId) {
				replaceUrl({
					query: {
						transaction: transactionId,
						processingPayment: true,
					},
				});
				setIsProcessingPayment(true);
				const pendingMessage =
					transactionEventMessage ||
					(transactionActions.includes("CHARGE_ACTION_REQUIRED")
						? `已创建 ${methodDisplayName} 支付请求，请按照指引完成支付。完成后返回此页面会自动更新状态。`
						: `已创建 ${methodDisplayName} 支付请求，请在新的页面或客户端完成支付。`);
				setInfoMessage(pendingMessage);
				return;
			}

			showCustomErrors([{ message: commonErrorMessages.somethingWentWrong }]);
		} catch (error) {
			console.error("Epay transaction initialize failed", error);
			showCustomErrors([{ message: commonErrorMessages.somethingWentWrong }]);
		} finally {
			setIsSubmitting(false);
			if (!redirecting) {
				setIsProcessingPayment(false);
			}
		}
	}, [
		checkout.id,
		checkoutAmount,
		commonErrorMessages.somethingWentWrong,
		config.id,
		selectedMethod,
		setIsProcessingPayment,
		showSuccess,
		showCustomErrors,
		transactionInitialize,
		finalizeCheckout,
		getMethodLabel,
	]);

	return (
		<section className="shadow-soft mt-6 rounded-3xl border border-slate-200 bg-white/90 p-6 ring-1 ring-white/60">
			<header className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
				<div>
					<p className="text-base font-semibold text-slate-900">{config.data.gatewayName || "Epay 支付"}</p>
					<p className="text-sm text-slate-500">
						支持：
						{availableMethods.map(getMethodLabel).join(" / ")}
					</p>
				</div>
				{config.data?.supportedCurrencies?.length ? (
					<p className="text-xs text-slate-400">币种：{config.data?.supportedCurrencies?.join(" / ")}</p>
				) : null}
			</header>

			<div className="mt-4 flex flex-wrap gap-3">
				{availableMethods.map((method) => {
					const isActive = method === selectedMethod;
					return (
						<button
							key={method}
							type="button"
							onClick={() => setSelectedMethod(method)}
							className={[
								"rounded-2xl border px-4 py-2 text-sm font-medium transition",
								isActive
									? "border-slate-900 bg-slate-900 text-white"
									: "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-800",
							].join(" ")}
							aria-pressed={isActive}
						>
							{getMethodLabel(method)}
						</button>
					);
				})}
			</div>

			{currencyWarning ? (
				<div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-700">
					<strong className="mr-1 font-semibold">提醒：</strong>
					{currencyWarning}
				</div>
			) : null}

			<div className="mt-6">
				<Button
					variant="primary"
					label={
						isSubmitting || initializingPayment
							? "正在创建支付..."
							: currencySupported
								? "前往支付"
								: `币种 ${checkoutCurrency ?? ""} 不受支持`
					}
					disabled={isSubmitting || initializingPayment || !currencySupported}
					onClick={handlePayment}
				/>
			</div>

			{infoMessage ? <p className="mt-4 text-sm text-slate-600">{infoMessage}</p> : null}
			{requestMode === "submit" ? (
				<p className="mt-2 text-xs text-slate-400">
					此支付方式需要打开新的页面完成付款，请确保浏览器允许弹出窗口。
				</p>
			) : null}

			{qrLink ? (
				<div className="mt-6 space-y-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-4">
					{qrImage ? (
						<div className="flex flex-col items-center gap-3">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img
								src={qrImage}
								alt="Epay QR code"
								className="h-48 w-48 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
							/>
							<p className="text-xs text-slate-500">请使用对应的支付应用扫描二维码完成支付</p>
						</div>
					) : null}
					<p className="text-sm font-medium text-slate-700">二维码链接：</p>
					<code className="block max-h-40 overflow-auto rounded-2xl bg-white px-4 py-3 text-xs text-slate-600">
						{qrLink}
					</code>
					<div className="flex flex-wrap gap-2">
						<Button variant="secondary" label="复制链接" onClick={handleCopyQrLink} />
						<Button
							variant="secondary"
							label="在新窗口打开"
							onClick={() => window.open(qrLink, "_blank", "noopener,noreferrer")}
						/>
					</div>
				</div>
			) : null}
		</section>
	);
};
