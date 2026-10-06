package com.yadbin.teacher.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import androidx.navigation.compose.rememberNavController
import com.yadbin.teacher.ui.activities.ActivityScreen
import com.yadbin.teacher.ui.account.AccountScreen
import com.yadbin.teacher.ui.activities.AiBuilderScreen
import com.yadbin.teacher.ui.activities.CreateActivityScreen
import com.yadbin.teacher.ui.dashboard.OverviewScreen
import com.yadbin.teacher.ui.assessments.AssessmentScreen
import com.yadbin.teacher.ui.assessments.AssessmentsScreen
import com.yadbin.teacher.ui.auth.LoginScreen
import com.yadbin.teacher.ui.auth.RegisterScreen
import com.yadbin.teacher.ui.auth.ResetPasswordScreen
import com.yadbin.teacher.ui.auth.SplashScreen
import com.yadbin.teacher.ui.classes.ClassDetailScreen
import com.yadbin.teacher.ui.classes.CreateClassScreen
import com.yadbin.teacher.ui.common.LocalContainer
import com.yadbin.teacher.ui.dashboard.DashboardScreen
import com.yadbin.teacher.ui.growth.StudentGrowthScreen
import com.yadbin.teacher.ui.reports.StudentFullReportScreen
import com.yadbin.teacher.ui.reports.StudentReportScreen
import com.yadbin.teacher.ui.subscription.SubscriptionScreen
import com.yadbin.teacher.ui.subscription.UpgradeScreen
import com.yadbin.teacher.ui.sources.SourcesScreen
import com.yadbin.teacher.ui.sources.SourceDetailScreen
import com.yadbin.teacher.ui.sources.SourceQuizScreen
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton

object Routes {
    const val SPLASH = "splash"
    const val LOGIN = "login"
    const val REGISTER = "register"
    const val RESET = "resetPassword"
    const val DASHBOARD = "dashboard"
    const val CREATE_CLASS = "createClass"
    const val CLASS = "class/{id}"
    const val NEW_ACTIVITY = "newActivity/{classId}"
    const val ACTIVITY = "activity/{id}"
    const val STUDENT = "student/{id}?classId={classId}"
    const val STUDENT_GROWTH = "studentGrowth/{id}?classId={classId}"
    const val STUDENT_FULL_REPORT = "studentFullReport/{id}"
    const val AI_BUILDER = "aiBuilder/{classId}?studentId={studentId}"
    const val OVERVIEW = "overview"
    const val ASSESSMENTS = "assessments"
    const val ASSESSMENT = "assessment/{id}"
    const val SUBSCRIPTION = "subscription"
    const val UPGRADE = "upgrade"
    const val ACCOUNT = "account"
    const val SOURCES = "sources"
    const val SOURCE = "source/{id}"
    const val SOURCE_QUIZ = "sourceQuiz/{id}?replace={replace}"
}

private fun NavHostController.toLoginClearingStack() {
    navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
}

@Composable
fun AppNav() {
    val nav = rememberNavController()
    val container = LocalContainer.current
    val expired by container.sessionExpired.collectAsStateWithLifecycle()

    // Token rejected by the server -> back to Login.
    LaunchedEffect(expired) { if (expired) nav.toLoginClearingStack() }

    // Server refused something because a Free-plan limit was reached: say so in the server's words and offer the upgrade screen.
    val limitMessage by container.limitMessage.collectAsStateWithLifecycle()
    limitMessage?.let { msg ->
        AlertDialog(
            onDismissRequest = { container.limitMessage.value = null },
            title = { Text("به سقف پلن رایگان رسیدید") },
            text = { Text(msg) },
            confirmButton = { TextButton(onClick = { container.limitMessage.value = null; nav.navigate(Routes.UPGRADE) }) { Text("مشاهده پلن‌ها") } },
            dismissButton = { TextButton(onClick = { container.limitMessage.value = null }) { Text("بعداً") } },
        )
    }

    NavHost(navController = nav, startDestination = Routes.SPLASH) {
        composable(Routes.SPLASH) {
            SplashScreen { loggedIn ->
                nav.navigate(if (loggedIn) Routes.DASHBOARD else Routes.LOGIN) { popUpTo(Routes.SPLASH) { inclusive = true } }
            }
        }
        composable(Routes.LOGIN) {
            LoginScreen(
                onLoggedIn = { nav.navigate(Routes.DASHBOARD) { popUpTo(0) { inclusive = true } } },
                onRegister = { nav.navigate(Routes.REGISTER) },
                onForgot = { nav.navigate(Routes.RESET) },
            )
        }
        composable(Routes.RESET) {
            ResetPasswordScreen(
                onDone = { nav.navigate(Routes.DASHBOARD) { popUpTo(0) { inclusive = true } } },
                onBack = { nav.popBackStack() },
            )
        }
        composable(Routes.REGISTER) {
            RegisterScreen(
                onRegistered = { nav.navigate(Routes.DASHBOARD) { popUpTo(0) { inclusive = true } } },
                onBackToLogin = { nav.popBackStack() },
            )
        }
        composable(Routes.DASHBOARD) {
            DashboardScreen(
                onOpenClass = { nav.navigate("class/$it") },
                onCreateClass = { nav.navigate(Routes.CREATE_CLASS) },
                onOverview = { nav.navigate(Routes.OVERVIEW) },
                onAssessments = { nav.navigate(Routes.ASSESSMENTS) },
                onSources = { nav.navigate(Routes.SOURCES) },
                onSubscription = { nav.navigate(Routes.SUBSCRIPTION) },
                onAccount = { nav.navigate(Routes.ACCOUNT) },
                onLoggedOut = { nav.toLoginClearingStack() },
            )
        }
        composable(Routes.CREATE_CLASS) {
            CreateClassScreen(
                onBack = { nav.popBackStack() },
                onCreated = { id -> nav.navigate("class/$id") { popUpTo(Routes.DASHBOARD) } },
            )
        }
        composable(Routes.CLASS) { e ->
            val id = e.arguments?.getString("id") ?: return@composable
            ClassDetailScreen(
                classId = id,
                onBack = { nav.popBackStack() },
                onNewActivity = { nav.navigate("newActivity/$id") },
                onOpenActivity = { nav.navigate("activity/$it") },
                onOpenStudent = { nav.navigate("student/$it?classId=$id") },
            )
        }
        composable(Routes.NEW_ACTIVITY) { e ->
            val classId = e.arguments?.getString("classId") ?: return@composable
            CreateActivityScreen(
                classId = classId,
                onBack = { nav.popBackStack() },
                onCreated = { activityId -> nav.navigate("activity/$activityId") { popUpTo(Routes.NEW_ACTIVITY) { inclusive = true } } },
                onAiBuilder = { nav.navigate("aiBuilder/$classId") },
            )
        }
        composable(
            Routes.AI_BUILDER,
            arguments = listOf(navArgument("studentId") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) { e ->
            val classId = e.arguments?.getString("classId") ?: return@composable
            AiBuilderScreen(
                classId = classId, studentId = e.arguments?.getString("studentId"), onBack = { nav.popBackStack() },
                // the draft is handed to the (editable) create form; the AI screen leaves the stack so Back from the form returns to the class
                onUseDraft = { nav.navigate("newActivity/$classId") { popUpTo(Routes.AI_BUILDER) { inclusive = true } } },
            )
        }
        composable(Routes.SOURCES) {
            SourcesScreen(onBack = { nav.popBackStack() }, onOpen = { nav.navigate("source/$it") }, onMakeQuiz = { })
        }
        composable(Routes.SOURCE) { e ->
            val id = e.arguments?.getString("id") ?: return@composable
            SourceDetailScreen(sourceId = id, onBack = { nav.popBackStack() }, onMakeQuiz = { nav.navigate("sourceQuiz/$it") })
        }
        composable(Routes.SOURCE_QUIZ, arguments = listOf(androidx.navigation.navArgument("replace") { type = androidx.navigation.NavType.StringType; nullable = true; defaultValue = null })) { e ->
            val id = e.arguments?.getString("id") ?: return@composable
            val replace = e.arguments?.getString("replace")
            SourceQuizScreen(
                sourceId = id, replaceAssessmentId = replace, onBack = { nav.popBackStack() },
                onCreated = { assessmentId ->
                    // editing rebuilds the same assessment: go back to it (it refreshes itself); creating opens the new draft
                    if (replace != null) nav.popBackStack() else nav.navigate("assessment/$assessmentId") { popUpTo(Routes.SOURCE_QUIZ) { inclusive = true } }
                },
            )
        }
        composable(Routes.ASSESSMENTS) {
            AssessmentsScreen(onBack = { nav.popBackStack() }, onOpen = { nav.navigate("assessment/$it") })
        }
        composable(Routes.ASSESSMENT) { e ->
            val id = e.arguments?.getString("id") ?: return@composable
            AssessmentScreen(assessmentId = id, onBack = { nav.popBackStack() }, onOpenAssessment = { nav.navigate("assessment/$it") }, onRebuildFromSource = { sid, aid -> nav.navigate("sourceQuiz/$sid?replace=$aid") })
        }
        composable(Routes.SUBSCRIPTION) {
            SubscriptionScreen(onBack = { nav.popBackStack() }, onUpgrade = { nav.navigate(Routes.UPGRADE) })
        }
        composable(Routes.ACCOUNT) {
            AccountScreen(onBack = { nav.popBackStack() }, onAccountDeleted = { nav.toLoginClearingStack() })
        }
        composable(Routes.UPGRADE) {
            UpgradeScreen(onBack = { nav.popBackStack() })
        }
        composable(Routes.OVERVIEW) {
            OverviewScreen(onBack = { nav.popBackStack() }, onOpenClass = { nav.navigate("class/$it") })
        }
        composable(Routes.ACTIVITY) { e ->
            val id = e.arguments?.getString("id") ?: return@composable
            ActivityScreen(activityId = id, onBack = { nav.popBackStack() }, onOpenStudent = { nav.navigate("student/$it") }, onOpenActivity = { nav.navigate("activity/$it") })
        }
        composable(
            Routes.STUDENT,
            arguments = listOf(navArgument("classId") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) { e ->
            val id = e.arguments?.getString("id") ?: return@composable
            val classId = e.arguments?.getString("classId")
            StudentReportScreen(
                studentId = id, classId = classId, onBack = { nav.popBackStack() },
                onCreateActivity = { if (classId != null) nav.navigate("newActivity/$classId") },
                onAiBuilder = { if (classId != null) nav.navigate("aiBuilder/$classId?studentId=$id") },
                onOpenGrowth = { nav.navigate("studentGrowth/$id" + (if (classId != null) "?classId=$classId" else "")) },
                onOpenFullReport = { nav.navigate("studentFullReport/$id") },
            )
        }
        composable(
            Routes.STUDENT_GROWTH,
            arguments = listOf(navArgument("classId") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) { e ->
            val id = e.arguments?.getString("id") ?: return@composable
            val classId = e.arguments?.getString("classId")
            StudentGrowthScreen(
                studentId = id, classId = classId, onBack = { nav.popBackStack() },
                onCreateActivity = { if (classId != null) nav.navigate("newActivity/$classId") },
                onOpenReport = { nav.navigate("studentFullReport/$id") },
            )
        }
        composable(Routes.STUDENT_FULL_REPORT) { e ->
            val id = e.arguments?.getString("id") ?: return@composable
            StudentFullReportScreen(studentId = id, onBack = { nav.popBackStack() })
        }
    }
}
