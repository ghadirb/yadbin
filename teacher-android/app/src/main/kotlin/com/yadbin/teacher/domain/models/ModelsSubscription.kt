package com.yadbin.teacher.domain.models

import kotlinx.serialization.Serializable

/** Subscription / payment DTOs – mirror worker/src/routes/subscription.ts (docs/api.md). Every value comes from the server; the app never computes access. */
@Serializable data class SubLimits(
    val maxClasses: Int? = null,
    val maxStudents: Int? = null,
    val maxAssessments: Int? = null,
    val aiRequestsPerMonth: Int? = null,
)

@Serializable data class SubFeatures(val teacherAssessment: Boolean = true, val aiBuilder: Boolean = false, val fullReports: Boolean = false)

@Serializable data class SubEntitlements(
    val plan: String = "FREE",            // FREE | TRIAL | PRO
    val status: String = "FREE",          // FREE | TRIAL | ACTIVE | EXPIRED
    val trialActive: Boolean = false,
    val subscriptionActive: Boolean = false,
    val trialStartedAt: String? = null,
    val trialExpiresAt: String? = null,
    val expiresAt: String? = null,
    val planId: String? = null,
    val limits: SubLimits = SubLimits(),
    val features: SubFeatures = SubFeatures(),
    val serverTime: String = "",
)

@Serializable data class SubUsage(val classes: Int = 0, val students: Int = 0, val assessments: Int = 0, val aiRequests: Int = 0)

@Serializable data class SubscriptionResponse(
    val subscription: SubEntitlements = SubEntitlements(),
    val usage: SubUsage = SubUsage(),
    val paymentsAvailable: Boolean = false,
)

@Serializable data class PlanDto(
    val id: String,
    val name: String = "",
    val period: String = "monthly",
    val durationDays: Int = 30,
    val price: Long? = null,
    val currency: String = "IRR",
    val priceAvailable: Boolean = false,
)

@Serializable data class PlansResponse(
    val plans: List<PlanDto> = emptyList(),
    val free: SubLimits = SubLimits(),
    val trialDays: Int = 7,
    val paymentsAvailable: Boolean = false,
)

/** Body is only the plan id: price, user and dates are never sent by the app. */
@Serializable data class PaymentCreateRequest(val planId: String)

@Serializable data class PaymentCreated(
    val paymentId: String = "",
    val status: String = "pending",
    val provider: String = "",
    val kind: String = "",
    val redirectUrl: String? = null,
    val sku: String? = null,
    val developerPayload: String? = null,
    val expiresAt: String = "",
)

@Serializable data class MyketConfirmRequest(val originalJson: String, val signature: String)

@Serializable data class ConfirmResponse(val ok: Boolean = false, val paymentId: String = "", val status: String = "", val alreadyProcessed: Boolean = false)
