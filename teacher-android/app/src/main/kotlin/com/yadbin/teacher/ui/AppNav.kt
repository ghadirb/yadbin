package com.yadbin.teacher.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.yadbin.teacher.ui.activities.ActivityScreen
import com.yadbin.teacher.ui.activities.CreateActivityScreen
import com.yadbin.teacher.ui.auth.LoginScreen
import com.yadbin.teacher.ui.auth.RegisterScreen
import com.yadbin.teacher.ui.auth.ResetPasswordScreen
import com.yadbin.teacher.ui.auth.SplashScreen
import com.yadbin.teacher.ui.classes.ClassDetailScreen
import com.yadbin.teacher.ui.classes.CreateClassScreen
import com.yadbin.teacher.ui.common.LocalContainer
import com.yadbin.teacher.ui.dashboard.DashboardScreen
import com.yadbin.teacher.ui.reports.StudentReportScreen

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
    const val STUDENT = "student/{id}"
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
                onOpenStudent = { nav.navigate("student/$it") },
            )
        }
        composable(Routes.NEW_ACTIVITY) { e ->
            val classId = e.arguments?.getString("classId") ?: return@composable
            CreateActivityScreen(
                classId = classId,
                onBack = { nav.popBackStack() },
                onCreated = { activityId -> nav.navigate("activity/$activityId") { popUpTo(Routes.NEW_ACTIVITY) { inclusive = true } } },
            )
        }
        composable(Routes.ACTIVITY) { e ->
            val id = e.arguments?.getString("id") ?: return@composable
            ActivityScreen(activityId = id, onBack = { nav.popBackStack() }, onOpenStudent = { nav.navigate("student/$it") })
        }
        composable(Routes.STUDENT) { e ->
            val id = e.arguments?.getString("id") ?: return@composable
            StudentReportScreen(studentId = id, onBack = { nav.popBackStack() })
        }
    }
}
